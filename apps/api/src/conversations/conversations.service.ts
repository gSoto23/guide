import { createRequire } from "node:module";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  ChatSectionRef,
  ConversationDetail,
  ConversationSummary,
  MemberChatMessage,
  MemberTrace,
  NeedsHostReasonValue,
} from "@guidesk/contracts";
import {
  agentDraft,
  agentTrace,
  chatMessage,
  conversation,
  guide,
  guideVersion,
  property,
  stay,
  user,
} from "@guidesk/db";
import { can, memberReplyWarnings, type GuideSnapshot, type Role } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { RequestDb } from "../database/request-db.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { toMemberMessage } from "../chat/chat-messages.js";

export interface ConversationCaller {
  userId: string;
  role: Role;
}

const LIST_LIMIT = 200;
const MESSAGE_LIMIT = 500;

const require = createRequire(import.meta.url);
type GuestCatalog = { sections: Record<string, string> };
const SECTION_TITLES: Record<"es" | "en", Record<string, string>> = {
  es: (require("@guidesk/i18n/messages/guest.es.json") as GuestCatalog).sections,
  en: (require("@guidesk/i18n/messages/guest.en.json") as GuestCatalog).sections,
};

/**
 * The member side of the chat (feature 005 US3, research R11, FR-024 to FR-027): a property's
 * conversations, the conversation page with the open draft and "Why this reply", sending drafts,
 * and replies. Everything runs in the request's RLS context; member replies get the output checks
 * as warnings (PC-14).
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  private async assertProperty(workspaceId: string, propertyId: string): Promise<void> {
    const [row] = await this.tx
      .select({ id: property.id })
      .from(property)
      .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "property", propertyId);
    }
  }

  async list(workspaceId: string, propertyId: string): Promise<ConversationSummary[]> {
    await this.assertProperty(workspaceId, propertyId);
    const rows = await this.tx
      .select({
        id: conversation.id,
        status: conversation.status,
        reason: conversation.needsHostReason,
        lastMessageAt: conversation.lastMessageAt,
        checkInDate: stay.checkInDate,
        checkoutDate: stay.checkoutDate,
        last: sql<{ author: "guest" | "assistant" | "host"; body: string } | null>`(
          SELECT json_build_object('author', m.author, 'body', left(m.body, 200))
            FROM chat_message m
           WHERE m.conversation_id = ${conversation.id}
           ORDER BY m.seq DESC
           LIMIT 1)`,
      })
      .from(conversation)
      .leftJoin(stay, eq(stay.id, conversation.stayId))
      .where(
        and(eq(conversation.workspaceId, workspaceId), eq(conversation.propertyId, propertyId)),
      )
      .orderBy(sql`(${conversation.status} = 'needs_host') DESC`, desc(conversation.lastMessageAt))
      .limit(LIST_LIMIT);
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      reason: row.reason as NeedsHostReasonValue | null,
      stay:
        row.checkInDate && row.checkoutDate
          ? { checkInDate: row.checkInDate, checkoutDate: row.checkoutDate }
          : null,
      lastMessageAt: row.lastMessageAt.toISOString(),
      lastMessage: row.last,
    }));
  }

  async detail(
    caller: ConversationCaller,
    workspaceId: string,
    propertyId: string,
    conversationId: string,
  ): Promise<ConversationDetail> {
    const conv = await this.conversation(workspaceId, propertyId, conversationId);
    const messages = await this.tx
      .select({
        id: chatMessage.id,
        seq: chatMessage.seq,
        author: chatMessage.author,
        kind: chatMessage.kind,
        body: chatMessage.body,
        payload: chatMessage.payload,
        authorName: user.name,
        createdAt: chatMessage.createdAt,
      })
      .from(chatMessage)
      .leftJoin(user, eq(user.id, chatMessage.authorUserId))
      .where(eq(chatMessage.conversationId, conversationId))
      .orderBy(desc(chatMessage.seq))
      .limit(MESSAGE_LIMIT);
    const [draft] = await this.tx
      .select({
        id: agentDraft.id,
        body: agentDraft.body,
        sectionIds: agentDraft.sectionIds,
        traceId: agentDraft.traceId,
        createdAt: agentDraft.createdAt,
      })
      .from(agentDraft)
      .where(and(eq(agentDraft.conversationId, conversationId), eq(agentDraft.status, "open")))
      .limit(1);
    // The member projection: never model, tokens, or cost (FR-031; the grants enforce it too).
    const traces = await this.tx
      .select({
        id: agentTrace.id,
        messageId: agentTrace.replyMessageId,
        classification: agentTrace.classification,
        decision: agentTrace.decision,
        reason: agentTrace.reason,
        autonomy: agentTrace.autonomy,
        autonomySource: agentTrace.autonomySource,
        answerKind: agentTrace.answerKind,
        tone: agentTrace.tone,
        quietHours: agentTrace.quietHours,
        workspaceInstructionVersionId: agentTrace.workspaceInstructionVersionId,
        propertyInstructionVersionId: agentTrace.propertyInstructionVersionId,
        guideVersionId: agentTrace.guideVersionId,
        sectionIds: agentTrace.sectionIds,
        checks: agentTrace.checks,
        sentByName: user.name,
        edited: agentTrace.edited,
        createdAt: agentTrace.createdAt,
      })
      .from(agentTrace)
      .leftJoin(user, eq(user.id, agentTrace.sentBy))
      .where(eq(agentTrace.conversationId, conversationId))
      .orderBy(asc(agentTrace.createdAt))
      .limit(MESSAGE_LIMIT);
    const versionIds = [
      ...new Set(traces.map((trace) => trace.guideVersionId).filter((id): id is string => !!id)),
    ];
    const versions = versionIds.length
      ? await this.tx
          .select({
            id: guideVersion.id,
            number: guideVersion.number,
            snapshot: guideVersion.snapshot,
          })
          .from(guideVersion)
          .where(inArray(guideVersion.id, versionIds))
      : [];
    const titles = this.sectionTitles(
      conv.language,
      versions.map((version) => version.snapshot as GuideSnapshot),
    );
    const sections = (ids: readonly string[]): ChatSectionRef[] =>
      ids.map((id) => ({ id, title: titles.get(id) ?? "" })).filter((section) => section.title);
    const versionNumber = new Map(versions.map((version) => [version.id, version.number]));
    const traceSections = new Map(traces.map((trace) => [trace.id, trace.sectionIds]));
    return {
      ...conv.summary,
      propertyId,
      language: conv.language,
      messages: messages.reverse().map((row) => toMemberMessage(row)),
      draft: draft
        ? {
            id: draft.id,
            body: draft.body,
            sections: sections(
              draft.sectionIds.length
                ? draft.sectionIds
                : (traceSections.get(draft.traceId ?? "") ?? []),
            ),
            traceId: draft.traceId,
            createdAt: draft.createdAt.toISOString(),
          }
        : null,
      traces: traces.map((trace): MemberTrace => ({
        id: trace.id,
        messageId: trace.messageId,
        topic: typeof trace.classification?.topic === "string" ? trace.classification.topic : null,
        decision: trace.decision,
        reason: trace.reason as NeedsHostReasonValue | null,
        autonomy: trace.autonomy,
        autonomySource: trace.autonomySource,
        answerKind: trace.answerKind,
        tone: trace.tone,
        quietHours: trace.quietHours,
        instructions: {
          workspace: trace.workspaceInstructionVersionId !== null,
          property: trace.propertyInstructionVersionId !== null,
        },
        sections: sections(trace.sectionIds),
        checks: trace.checks,
        guideVersion: trace.guideVersionId
          ? (versionNumber.get(trace.guideVersionId) ?? null)
          : null,
        sentBy: trace.sentByName,
        edited: trace.edited,
        createdAt: trace.createdAt.toISOString(),
      })),
      canReply: can(caller.role, "conversations.handle"),
    };
  }

  /** Sends the open draft, unchanged or edited (FR-025, FR-026): the first send wins. */
  async sendDraft(
    caller: ConversationCaller,
    workspaceId: string,
    propertyId: string,
    conversationId: string,
    draftId: string,
    body: { text?: string | undefined; acknowledgeWarnings?: boolean | undefined },
  ): Promise<MemberChatMessage> {
    await this.conversation(workspaceId, propertyId, conversationId);
    const [draft] = await this.tx
      .select({
        id: agentDraft.id,
        body: agentDraft.body,
        sectionIds: agentDraft.sectionIds,
        traceId: agentDraft.traceId,
        status: agentDraft.status,
      })
      .from(agentDraft)
      .where(and(eq(agentDraft.id, draftId), eq(agentDraft.conversationId, conversationId)))
      .limit(1);
    if (!draft) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "agent_draft", draftId);
    }
    if (draft.status !== "open") throw new ApiProblem(409, "draft_closed");
    const text = body.text ?? draft.body;
    const edited = text !== draft.body;
    if (edited) await this.assertWarnings(propertyId, workspaceId, text, body.acknowledgeWarnings);
    const claimed = await this.tx
      .update(agentDraft)
      .set({ status: edited ? "edited" : "sent", actedBy: caller.userId, actedAt: sql`now()` })
      .where(and(eq(agentDraft.id, draftId), eq(agentDraft.status, "open")))
      .returning({ id: agentDraft.id });
    if (claimed.length === 0) throw new ApiProblem(409, "draft_closed");
    // A sent draft appears as the assistant (FR-027), recorded with the member who sent it.
    const titles = await this.draftSections(conversationId, draft.traceId, draft.sectionIds);
    const message = await this.insert(
      workspaceId,
      conversationId,
      caller,
      "assistant",
      text,
      titles.length ? { sections: titles } : null,
    );
    if (draft.traceId) {
      await this.tx
        .update(agentTrace)
        .set({ sentBy: caller.userId, edited })
        .where(eq(agentTrace.id, draft.traceId));
    }
    await this.securityLog.record({
      type: "conversation.replied",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "conversation",
      targetId: conversationId,
      metadata: { propertyId, conversationId, fromDraft: true, edited },
    });
    return message;
  }

  /** A member's own reply (FR-025): it closes the open draft (FR-026). */
  async reply(
    caller: ConversationCaller,
    workspaceId: string,
    propertyId: string,
    conversationId: string,
    body: { text: string; acknowledgeWarnings?: boolean | undefined },
  ): Promise<MemberChatMessage> {
    await this.conversation(workspaceId, propertyId, conversationId);
    await this.assertWarnings(propertyId, workspaceId, body.text, body.acknowledgeWarnings);
    const message = await this.insert(workspaceId, conversationId, caller, "host", body.text, null);
    await this.tx
      .update(agentDraft)
      .set({ status: "discarded", actedBy: caller.userId, actedAt: sql`now()` })
      .where(and(eq(agentDraft.conversationId, conversationId), eq(agentDraft.status, "open")));
    await this.securityLog.record({
      type: "conversation.replied",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "conversation",
      targetId: conversationId,
      metadata: { propertyId, conversationId, fromDraft: false, edited: false },
    });
    return message;
  }

  private async conversation(workspaceId: string, propertyId: string, conversationId: string) {
    await this.assertProperty(workspaceId, propertyId);
    const [row] = await this.tx
      .select({
        id: conversation.id,
        status: conversation.status,
        reason: conversation.needsHostReason,
        language: conversation.language,
        lastMessageAt: conversation.lastMessageAt,
        checkInDate: stay.checkInDate,
        checkoutDate: stay.checkoutDate,
      })
      .from(conversation)
      .leftJoin(stay, eq(stay.id, conversation.stayId))
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
    const summary: ConversationSummary = {
      id: row.id,
      status: row.status,
      reason: row.reason as NeedsHostReasonValue | null,
      stay:
        row.checkInDate && row.checkoutDate
          ? { checkInDate: row.checkInDate, checkoutDate: row.checkoutDate }
          : null,
      lastMessageAt: row.lastMessageAt.toISOString(),
      lastMessage: null,
    };
    return { summary, language: row.language };
  }

  /**
   * Inserts a member's message: locking the conversation row (the status update) serializes
   * numbering with the guest and the assistant, and clears "needs the host" (FR-026).
   */
  private async insert(
    workspaceId: string,
    conversationId: string,
    caller: ConversationCaller,
    author: "host" | "assistant",
    text: string,
    payload: Record<string, unknown> | null,
  ): Promise<MemberChatMessage> {
    await this.tx
      .update(conversation)
      .set({ status: "open", needsHostReason: null, lastMessageAt: sql`now()` })
      .where(eq(conversation.id, conversationId));
    const [next] = await this.tx
      .select({ seq: sql<number>`coalesce(max(${chatMessage.seq}), 0)::int + 1` })
      .from(chatMessage)
      .where(eq(chatMessage.conversationId, conversationId));
    const [row] = await this.tx
      .insert(chatMessage)
      .values({
        workspaceId,
        conversationId,
        seq: next!.seq,
        author,
        kind: "text",
        body: text,
        payload,
        authorUserId: caller.userId,
      })
      .returning();
    const [me] = await this.tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, caller.userId))
      .limit(1);
    return toMemberMessage({ ...row!, authorName: me?.name ?? null });
  }

  /** PC-14: links, promises, and off-platform phrases warn; the member may send anyway. */
  private async assertWarnings(
    propertyId: string,
    workspaceId: string,
    text: string,
    acknowledged: boolean | undefined,
  ): Promise<void> {
    if (acknowledged) return;
    const [published] = await this.tx
      .select({ snapshot: guideVersion.snapshot })
      .from(guide)
      .innerJoin(guideVersion, eq(guideVersion.id, guide.publishedVersionId))
      .where(and(eq(guide.propertyId, propertyId), eq(guide.workspaceId, workspaceId)))
      .limit(1);
    const warnings = memberReplyWarnings(text, {
      knowledgeText: published ? JSON.stringify(published.snapshot) : "",
      sectionIds: new Set(),
      guideOrigin: this.config.GUIDE_URL.replace(/\/$/, ""),
    });
    if (warnings.length > 0) {
      throw new ApiProblem(422, "reply_warnings", undefined, { details: { warnings } });
    }
  }

  private async draftSections(
    conversationId: string,
    traceId: string | null,
    sectionIds: readonly string[],
  ): Promise<ChatSectionRef[]> {
    if (!traceId || sectionIds.length === 0) return [];
    const [row] = await this.tx
      .select({ snapshot: guideVersion.snapshot, language: conversation.language })
      .from(agentTrace)
      .innerJoin(guideVersion, eq(guideVersion.id, agentTrace.guideVersionId))
      .innerJoin(conversation, eq(conversation.id, agentTrace.conversationId))
      .where(and(eq(agentTrace.id, traceId), eq(agentTrace.conversationId, conversationId)))
      .limit(1);
    if (!row) return [];
    const titles = this.sectionTitles(row.language, [row.snapshot as GuideSnapshot]);
    return sectionIds
      .map((id) => ({ id, title: titles.get(id) ?? "" }))
      .filter((section) => section.title);
  }

  /** Section titles as the guest saw them: the guest catalog, or the custom title. */
  private sectionTitles(language: "es" | "en", snapshots: GuideSnapshot[]): Map<string, string> {
    const names = SECTION_TITLES[language];
    const titles = new Map<string, string>();
    for (const snapshot of snapshots) {
      for (const section of snapshot.sections) {
        const custom =
          section.kind === "custom"
            ? (section.title?.[language] ?? Object.values(section.title ?? {})[0] ?? null)
            : null;
        titles.set(section.id, custom ?? names[section.kind] ?? names.custom ?? section.kind);
      }
    }
    return titles;
  }
}
