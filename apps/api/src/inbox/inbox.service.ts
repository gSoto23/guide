import { Injectable } from "@nestjs/common";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type {
  CopilotDraft,
  CopilotRequest,
  InboxItem,
  InboxPage,
  InboxQuery,
  NeedsHostReasonValue,
  TrustSuggestion,
} from "@guidesk/contracts";
import {
  agentDraft,
  assistantSuggestionDismissal,
  conversation,
  conversationPresence,
  copilotRun,
  guide,
  loadAssistantSettingsRows,
  property,
  stay,
  user,
} from "@guidesk/db";
import {
  isAutonomyTopic,
  JOB_QUEUES,
  levelFor,
  resolveAssistantSettings,
  type CopilotDraftJob,
  type Role,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { publishedSectionRefs } from "../common/section-titles.js";
import { RequestDb } from "../database/request-db.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";

export interface InboxCaller {
  userId: string;
  role: Role;
}

const PAGE = 50;
const EXCERPT = 140;
const PRESENCE_SECONDS = 30;
/** Research R9: five drafts sent unchanged in 30 days; dismissal lasts 30 days. */
const SUGGEST_AFTER = 5;
const SUGGEST_DAYS = 30;
/** Research R5: 60 copilot drafts per member per hour. */
const COPILOT_PER_HOUR = 60;

/**
 * The host inbox (feature 006 research R1 to R5, R8, R9): the workspace's conversations by tab, the
 * conversation actions (done, reopen, reject, take over), presence, trust suggestions, and copilot
 * drafts. Everything runs in the request's RLS context; actions are in the security log.
 */
@Injectable()
export class InboxService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
    private readonly jobs: JobQueueService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  async inbox(caller: InboxCaller, workspaceId: string, query: InboxQuery): Promise<InboxPage> {
    const taker = alias(user, "taker");
    const offset = Math.max(0, Number.parseInt(query.before ?? "0", 10) || 0);
    const tab =
      query.tab === "needs"
        ? eq(conversation.status, "needs_host")
        : query.tab === "done"
          ? eq(conversation.status, "done")
          : ne(conversation.status, "done");
    const order =
      query.tab === "needs"
        ? [
            sql`(${conversation.needsHostReason} = 'emergency') DESC`,
            desc(conversation.lastMessageAt),
            desc(conversation.id),
          ]
        : query.tab === "done"
          ? [desc(conversation.doneAt), desc(conversation.id)]
          : [desc(conversation.lastMessageAt), desc(conversation.id)];
    const rows = await this.tx
      .select({
        id: conversation.id,
        propertyId: conversation.propertyId,
        propertyName: property.name,
        status: conversation.status,
        reason: conversation.needsHostReason,
        lastMessageAt: conversation.lastMessageAt,
        takenOverAt: conversation.takenOverAt,
        takerName: sql<string | null>`coalesce(nullif(${taker.name}, ''), ${taker.email})`,
        checkInDate: stay.checkInDate,
        checkoutDate: stay.checkoutDate,
        stayId: stay.id,
        guestName: stay.guestName,
        last: sql<{ author: "guest" | "assistant" | "host"; excerpt: string } | null>`(
          SELECT json_build_object('author', m.author, 'excerpt', left(m.body, ${EXCERPT}))
            FROM chat_message m
           WHERE m.conversation_id = ${conversation.id}
           ORDER BY m.seq DESC
           LIMIT 1)`,
        replying: sql<string[]>`ARRAY(
          SELECT coalesce(nullif(u.name, ''), u.email) FROM conversation_presence p JOIN "user" u ON u.id = p.user_id
           WHERE p.conversation_id = ${conversation.id} AND p.expires_at > now()
             AND p.user_id <> ${caller.userId}
           ORDER BY u.name)`,
      })
      .from(conversation)
      .innerJoin(property, eq(property.id, conversation.propertyId))
      .leftJoin(stay, eq(stay.id, conversation.stayId))
      .leftJoin(taker, eq(taker.id, conversation.takenOverBy))
      .where(
        and(
          eq(conversation.workspaceId, workspaceId),
          tab,
          ...(query.propertyId ? [eq(conversation.propertyId, query.propertyId)] : []),
        ),
      )
      .orderBy(...order)
      .limit(PAGE + 1)
      .offset(offset);
    const items: InboxItem[] = rows.slice(0, PAGE).map((row) => ({
      id: row.id,
      propertyId: row.propertyId,
      propertyName: row.propertyName,
      status: row.status,
      reason: row.reason as NeedsHostReasonValue | null,
      stay:
        row.checkInDate && row.checkoutDate
          ? {
              id: row.stayId!,
              checkInDate: row.checkInDate,
              checkoutDate: row.checkoutDate,
              // Feature 018: the name the host knows, for the host's own screens only.
              guestName: row.guestName ?? null,
            }
          : null,
      channel: "guide_chat",
      lastMessageAt: row.lastMessageAt.toISOString(),
      lastMessage: row.last,
      takenOver: row.takenOverAt !== null,
      takenOverBy: row.takenOverAt ? row.takerName : null,
      replying: (row.replying ?? []).filter(Boolean),
    }));
    const [published] = await this.tx
      .select({ id: guide.id })
      .from(guide)
      .where(and(eq(guide.workspaceId, workspaceId), eq(guide.status, "published")))
      .limit(1);
    return {
      items,
      next: rows.length > PAGE ? String(offset + PAGE) : null,
      hasPublishedGuide: Boolean(published),
      suggestions: offset === 0 ? await this.suggestions(workspaceId) : [],
    };
  }

  /** Research R9: topics whose drafts were sent unchanged often enough to trust the assistant. */
  private async suggestions(workspaceId: string): Promise<TrustSuggestion[]> {
    const counts = await this.tx.execute<{
      property_id: string;
      property_name: string;
      topic: string;
      n: number;
    }>(sql`
      SELECT c.property_id, p.name AS property_name, tr.classification->>'topic' AS topic,
             count(*)::int AS n
        FROM agent_draft d
        JOIN agent_trace tr ON tr.id = d.trace_id
        JOIN conversation c ON c.id = d.conversation_id
        JOIN property p ON p.id = c.property_id
       WHERE d.workspace_id = ${workspaceId}
         AND d.status = 'sent'
         AND d.acted_at > now() - make_interval(days => ${SUGGEST_DAYS})
         AND tr.autonomy = 'draft'
         AND p.status = 'active'
       GROUP BY 1, 2, 3
      HAVING count(*) >= ${SUGGEST_AFTER}
       ORDER BY n DESC
       LIMIT 10`);
    const dismissed = await this.tx
      .select({
        propertyId: assistantSuggestionDismissal.propertyId,
        topic: assistantSuggestionDismissal.topic,
      })
      .from(assistantSuggestionDismissal)
      .where(
        and(
          eq(assistantSuggestionDismissal.workspaceId, workspaceId),
          sql`${assistantSuggestionDismissal.dismissedUntil} > now()`,
        ),
      );
    const hidden = new Set(dismissed.map((row) => `${row.propertyId}:${row.topic}`));
    const suggestions: TrustSuggestion[] = [];
    for (const row of counts.rows) {
      if (!isAutonomyTopic(row.topic) || hidden.has(`${row.property_id}:${row.topic}`)) continue;
      const settings = await loadAssistantSettingsRows(this.tx, workspaceId, row.property_id);
      const effective = resolveAssistantSettings(settings.workspace, settings.property);
      if (levelFor(effective.autonomy, row.topic) !== "draft") continue;
      suggestions.push({
        propertyId: row.property_id,
        propertyName: row.property_name,
        topic: row.topic,
        count: Number(row.n),
        scope: effective.sources.autonomy,
      });
    }
    return suggestions;
  }

  async dismissSuggestion(
    caller: InboxCaller,
    workspaceId: string,
    propertyId: string,
    topic: string,
  ): Promise<void> {
    await this.assertProperty(workspaceId, propertyId);
    const until = sql`now() + make_interval(days => ${SUGGEST_DAYS})`;
    await this.tx
      .insert(assistantSuggestionDismissal)
      .values({ workspaceId, propertyId, topic, dismissedUntil: until, dismissedBy: caller.userId })
      .onConflictDoUpdate({
        target: [assistantSuggestionDismissal.propertyId, assistantSuggestionDismissal.topic],
        set: { dismissedUntil: until, dismissedBy: caller.userId },
      });
  }

  private async assertProperty(workspaceId: string, propertyId: string) {
    const [row] = await this.tx
      .select({ id: property.id })
      .from(property)
      .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "property", propertyId);
    }
  }

  private async conversationOf(workspaceId: string, propertyId: string, conversationId: string) {
    await this.assertProperty(workspaceId, propertyId);
    const [row] = await this.tx
      .select({ id: conversation.id, status: conversation.status })
      .from(conversation)
      .where(
        and(
          eq(conversation.id, conversationId),
          eq(conversation.workspaceId, workspaceId),
          eq(conversation.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(
        this.tx,
        workspaceId,
        "conversation",
        conversationId,
      );
    }
    return row;
  }

  private async log(
    type:
      | "conversation.taken_over"
      | "conversation.handed_back"
      | "conversation.draft_rejected"
      | "conversation.marked_done"
      | "conversation.reopened",
    caller: InboxCaller,
    workspaceId: string,
    propertyId: string,
    conversationId: string,
  ): Promise<void> {
    await this.securityLog.record({
      type,
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "conversation",
      targetId: conversationId,
      metadata: { propertyId, conversationId },
    });
  }

  /** Research R2: done leaves the inbox's open tabs; its open draft is no longer needed. */
  async markDone(
    caller: InboxCaller,
    workspaceId: string,
    propertyId: string,
    conversationId: string,
  ): Promise<void> {
    await this.conversationOf(workspaceId, propertyId, conversationId);
    const updated = await this.tx
      .update(conversation)
      .set({
        status: "done",
        needsHostReason: null,
        doneAt: sql`now()`,
        doneBy: caller.userId,
      })
      .where(and(eq(conversation.id, conversationId), ne(conversation.status, "done")))
      .returning({ id: conversation.id });
    if (updated.length === 0) throw new ApiProblem(409, "conversation_done");
    await this.tx
      .update(agentDraft)
      .set({ status: "discarded", actedBy: caller.userId, actedAt: sql`now()` })
      .where(and(eq(agentDraft.conversationId, conversationId), eq(agentDraft.status, "open")));
    await this.log("conversation.marked_done", caller, workspaceId, propertyId, conversationId);
  }

  async reopen(
    caller: InboxCaller,
    workspaceId: string,
    propertyId: string,
    conversationId: string,
  ): Promise<void> {
    await this.conversationOf(workspaceId, propertyId, conversationId);
    const updated = await this.tx
      .update(conversation)
      .set({ status: "open", doneAt: null, doneBy: null })
      .where(and(eq(conversation.id, conversationId), eq(conversation.status, "done")))
      .returning({ id: conversation.id });
    if (updated.length > 0) {
      await this.log("conversation.reopened", caller, workspaceId, propertyId, conversationId);
    }
  }

  /** Research R3: nothing reaches the guest; the first action on a draft wins. */
  async rejectDraft(
    caller: InboxCaller,
    workspaceId: string,
    propertyId: string,
    conversationId: string,
    draftId: string,
  ): Promise<void> {
    await this.conversationOf(workspaceId, propertyId, conversationId);
    const [draft] = await this.tx
      .select({ id: agentDraft.id, status: agentDraft.status })
      .from(agentDraft)
      .where(and(eq(agentDraft.id, draftId), eq(agentDraft.conversationId, conversationId)))
      .limit(1);
    if (!draft) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "agent_draft", draftId);
    }
    const claimed = await this.tx
      .update(agentDraft)
      .set({ status: "discarded", actedBy: caller.userId, actedAt: sql`now()` })
      .where(and(eq(agentDraft.id, draftId), eq(agentDraft.status, "open")))
      .returning({ id: agentDraft.id });
    if (claimed.length === 0) throw new ApiProblem(409, "draft_closed");
    await this.log("conversation.draft_rejected", caller, workspaceId, propertyId, conversationId);
  }

  /** Research R4: the assistant stops answering while a member replies themselves. */
  async takeover(
    caller: InboxCaller,
    workspaceId: string,
    propertyId: string,
    conversationId: string,
    on: boolean,
  ): Promise<void> {
    await this.conversationOf(workspaceId, propertyId, conversationId);
    await this.tx
      .update(conversation)
      .set(
        on
          ? { takenOverBy: caller.userId, takenOverAt: sql`now()` }
          : { takenOverBy: null, takenOverAt: null },
      )
      .where(eq(conversation.id, conversationId));
    await this.log(
      on ? "conversation.taken_over" : "conversation.handed_back",
      caller,
      workspaceId,
      propertyId,
      conversationId,
    );
  }

  /** Research R8: a heartbeat keeps "{name} is replying" for 30 seconds. */
  async presence(
    caller: InboxCaller,
    workspaceId: string,
    propertyId: string,
    conversationId: string,
  ): Promise<void> {
    await this.conversationOf(workspaceId, propertyId, conversationId);
    const expires = sql`now() + make_interval(secs => ${PRESENCE_SECONDS})`;
    await this.tx
      .insert(conversationPresence)
      .values({ conversationId, userId: caller.userId, workspaceId, expiresAt: expires })
      .onConflictDoUpdate({
        target: [conversationPresence.conversationId, conversationPresence.userId],
        set: { expiresAt: expires },
      });
  }

  /** Research R5: stores the pasted message and queues the draft. */
  async createCopilot(
    caller: InboxCaller,
    workspaceId: string,
    propertyId: string,
    body: CopilotRequest,
  ): Promise<{ id: string }> {
    const [prop] = await this.tx
      .select({ guideStatus: guide.status, publishedVersionId: guide.publishedVersionId })
      .from(property)
      .leftJoin(guide, eq(guide.propertyId, property.id))
      .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
      .limit(1);
    if (!prop) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "property", propertyId);
    }
    if (prop.guideStatus !== "published" || !prop.publishedVersionId) {
      throw new ApiProblem(409, "guide_not_published");
    }
    const limit = await this.rateLimit.consume(
      `copilot:user:${caller.userId}`,
      COPILOT_PER_HOUR,
      3600,
    );
    if (!limit.allowed) {
      throw new ApiProblem(429, "copilot_paused", undefined, {
        retryAfterSeconds: limit.retryAfterSeconds,
        details: { retryAfterSeconds: limit.retryAfterSeconds },
      });
    }
    const [row] = await this.tx
      .insert(copilotRun)
      .values({
        workspaceId,
        propertyId,
        createdBy: caller.userId,
        message: body.message,
        bookingStatus: body.bookingStatus,
        language: body.language,
      })
      .returning({ id: copilotRun.id });
    const job: CopilotDraftJob = { runId: row!.id, workspaceId };
    await this.jobs.send(JOB_QUEUES.copilotDraft, job, {
      singletonKey: row!.id,
      retryLimit: 1,
      expireInSeconds: 60,
    });
    return { id: row!.id };
  }

  async getCopilot(workspaceId: string, propertyId: string, runId: string): Promise<CopilotDraft> {
    const [row] = await this.tx
      .select()
      .from(copilotRun)
      .where(
        and(
          eq(copilotRun.id, runId),
          eq(copilotRun.workspaceId, workspaceId),
          eq(copilotRun.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "copilot_run", runId);
    }
    const covered = row.covered;
    const passed =
      row.status === "done" &&
      row.outcome === "drafted" &&
      covered === true &&
      row.checks.every((check) => check.passed);
    return {
      id: row.id,
      status: row.status,
      outcome: row.outcome,
      draft: row.draft,
      sections: await publishedSectionRefs(
        this.tx,
        workspaceId,
        propertyId,
        row.sectionIds,
        row.language,
      ),
      checks: row.checks,
      passed,
      removed: row.removed.filter(
        (item): item is "link" | "email" | "phone" =>
          item === "link" || item === "email" || item === "phone",
      ),
      caution: row.caution,
      covered,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
