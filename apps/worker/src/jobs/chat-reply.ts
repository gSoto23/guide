import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  agentDraft,
  agentTrace,
  chatHeldNotice,
  chatMessage,
  chatUsageDaily,
  conversation,
  membership,
  stay,
  user,
  type Database,
} from "@guidesk/db";
import {
  JOB_QUEUES,
  type ChatReplyJob,
  type ContactsSetting,
  type NeedsHostReason,
  type NotificationPushJob,
} from "@guidesk/domain";
import {
  renderChatLimitReached,
  renderChatNeedsHost,
  toEmailLocale,
  type ChatNeedsHostReason,
} from "@guidesk/emails";
import type { ChatTurn, EmailMessage } from "@guidesk/integrations";
import {
  ANSWER_HISTORY,
  decideReply,
  loadAppliedSettings,
  loadPropertyContext,
  recordUsage,
  traceSettings,
  usageToday,
  type AppliedSettings,
  type Outcome,
  type PipelineDeps,
  type PropertyContext,
} from "./assistant-pipeline.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * The assistant's reply to a guest (feature 005 research R2 to R6, R8, R9, R12; feature 007): the
 * shared decision pipeline, then the reply, holding reply, or draft with a trace for every output,
 * and the "needs the host" email to the escalation contacts, held during quiet hours unless urgent.
 * Runs in the system context; every query names the job's workspace.
 */
export interface ChatReplyDeps extends PipelineDeps {
  queueEmail: (message: EmailMessage) => Promise<void>;
  /** Feature 006: web push to the same recipients as email (research R7). */
  queuePush?: (job: NotificationPushJob) => Promise<void>;
  portalUrl: string;
  span?: JobSpanDeps;
  /** Tests move the clock for quiet hours. */
  now?: () => Date;
}

export type ChatReplyOutcome =
  | "answered"
  | "drafted"
  | "held"
  | "pointer"
  | "greeting"
  | "skipped"
  | "superseded"
  | "unavailable";

const NOTIFY_EVERY_MINUTES = 30;
/** Reasons emailed at once even during quiet hours (feature 007 FR-008). */
const URGENT_REASONS: ReadonlySet<NeedsHostReason> = new Set(["emergency", "malfunction"]);

interface Loaded extends PropertyContext {
  conversationId: string;
  status: "open" | "needs_host" | "done";
  language: "es" | "en";
  stayId: string | null;
  /** Feature 006: the member who took the conversation over (null when they left or nobody did). */
  takenOverBy: string | null;
  takenOver: boolean;
}

interface StoredMessage {
  id: string;
  seq: number;
  author: "guest" | "assistant" | "host";
  body: string;
}

async function load(db: Database, job: ChatReplyJob): Promise<Loaded | null> {
  const [row] = await db
    .select({
      conversationId: conversation.id,
      propertyId: conversation.propertyId,
      status: conversation.status,
      language: conversation.language,
      stayId: conversation.stayId,
      takenOverBy: conversation.takenOverBy,
      takenOverAt: conversation.takenOverAt,
    })
    .from(conversation)
    .where(
      and(eq(conversation.id, job.conversationId), eq(conversation.workspaceId, job.workspaceId)),
    )
    .limit(1);
  if (!row) return null;
  const context = await loadPropertyContext(db, job.workspaceId, row.propertyId);
  if (!context) return null;
  return {
    ...context,
    conversationId: row.conversationId,
    status: row.status,
    language: row.language,
    stayId: row.stayId,
    takenOverBy: row.takenOverBy,
    takenOver: row.takenOverAt !== null,
  };
}

async function recentMessages(db: Database, conversationId: string): Promise<StoredMessage[]> {
  const rows = await db
    .select({
      id: chatMessage.id,
      seq: chatMessage.seq,
      author: chatMessage.author,
      body: chatMessage.body,
    })
    .from(chatMessage)
    .where(eq(chatMessage.conversationId, conversationId))
    .orderBy(desc(chatMessage.seq))
    .limit(ANSWER_HISTORY + 10);
  return rows.reverse();
}

function toTurns(messages: readonly StoredMessage[]): ChatTurn[] {
  return messages.map((message) => ({ role: message.author, text: message.body }));
}

/** Whether the last assistant reply was a clarifying question (feature 007 FR-004). */
async function previousWasClarify(
  db: Database,
  loaded: Loaded,
  history: readonly StoredMessage[],
): Promise<boolean> {
  const last = history.findLast((message) => message.author !== "guest");
  if (!last || last.author !== "assistant") return false;
  const [trace] = await db
    .select({ answerKind: agentTrace.answerKind })
    .from(agentTrace)
    .where(
      and(eq(agentTrace.workspaceId, loaded.workspaceId), eq(agentTrace.replyMessageId, last.id)),
    )
    .limit(1);
  return trace?.answerKind === "clarify";
}

/** Writes the run's messages, status, draft, trace, and usage in one transaction. */
async function write(
  db: Database,
  loaded: Loaded,
  lastSeq: number,
  batch: StoredMessage[],
  outcome: Outcome,
  applied: AppliedSettings,
): Promise<{ written: boolean; becameNeedsHost: boolean }> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: conversation.status })
      .from(conversation)
      .where(eq(conversation.id, loaded.conversationId))
      .for("update");
    const [current] = await tx
      .select({ seq: sql<number>`coalesce(max(${chatMessage.seq}), 0)::int` })
      .from(chatMessage)
      .where(eq(chatMessage.conversationId, loaded.conversationId));
    const record = async () => {
      if (outcome.usedModel) {
        await recordUsage(tx, loaded.workspaceId, loaded.propertyId, outcome.usage);
      }
    };
    if (!locked || (current?.seq ?? 0) !== lastSeq) {
      // Someone wrote meanwhile (the guest again, or a member): the queued run answers it all.
      await record();
      return { written: false, becameNeedsHost: false };
    }
    let seq = lastSeq;
    const ids: string[] = [];
    for (const message of outcome.messages) {
      seq += 1;
      const [row] = await tx
        .insert(chatMessage)
        .values({
          workspaceId: loaded.workspaceId,
          conversationId: loaded.conversationId,
          seq,
          author: "assistant",
          kind: message.kind,
          body: message.body,
          payload: message.payload ?? null,
        })
        .returning({ id: chatMessage.id });
      ids.push(row!.id);
    }
    const needsHost = outcome.reason !== null;
    await tx
      .update(conversation)
      .set({
        lastMessageAt: sql`now()`,
        // Answers, pointers, and greetings leave an earlier "needs the host" as it was.
        ...(needsHost
          ? {
              status: "needs_host" as const,
              needsHostReason: outcome.reason,
              // A member may have marked it done meanwhile (feature 006 research R2).
              doneAt: null,
              doneBy: null,
            }
          : {}),
      })
      .where(eq(conversation.id, loaded.conversationId));
    const [trace] = await tx
      .insert(agentTrace)
      .values({
        workspaceId: loaded.workspaceId,
        conversationId: loaded.conversationId,
        guestMessageId: batch.at(-1)!.id,
        replyMessageId:
          outcome.decision === "held" || outcome.decision === "drafted" ? null : ids[0]!,
        classification: outcome.classification as Record<string, unknown> | null,
        decision: outcome.decision,
        reason: outcome.reason,
        ...traceSettings(outcome, applied),
        guideVersionId: loaded.publishedVersionId,
        sectionIds: outcome.sectionIds,
        checks: outcome.checks,
        model: outcome.model,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        cacheReadTokens: outcome.usage.cacheReadTokens,
        cacheWriteTokens: outcome.usage.cacheWriteTokens,
        costUsdMicros: outcome.usage.costUsdMicros,
      })
      .returning({ id: agentTrace.id });
    if (outcome.draft) {
      // One open draft per conversation: a new one supersedes the older (edge cases).
      await tx
        .update(agentDraft)
        .set({ status: "superseded", actedAt: sql`now()` })
        .where(
          and(eq(agentDraft.conversationId, loaded.conversationId), eq(agentDraft.status, "open")),
        );
      await tx.insert(agentDraft).values({
        workspaceId: loaded.workspaceId,
        conversationId: loaded.conversationId,
        traceId: trace!.id,
        body: outcome.draft.body,
        sectionIds: outcome.draft.sectionIds,
      });
    }
    await record();
    return { written: true, becameNeedsHost: needsHost };
  });
}

interface Recipient {
  userId: string;
  email: string;
  locale: "es" | "en";
}

async function membersOf(
  db: Database,
  workspaceId: string,
  roles: ("owner" | "admin" | "agent")[],
): Promise<(Recipient & { membershipId: string })[]> {
  const rows = await db
    .select({
      membershipId: membership.id,
      userId: user.id,
      email: user.email,
      preferredLanguage: user.preferredLanguage,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.workspaceId, workspaceId), inArray(membership.role, roles)));
  return rows.map((row) => ({
    membershipId: row.membershipId,
    userId: row.userId,
    email: row.email,
    locale: toEmailLocale(row.preferredLanguage),
  }));
}

/**
 * The escalation contacts (feature 007 FR-010): the chosen members who still handle conversations,
 * or all of them when none are chosen or left; emergencies also go to every owner and admin.
 */
export async function recipientsFor(
  db: Database,
  workspaceId: string,
  contacts: ContactsSetting,
  reason: NeedsHostReason,
): Promise<Recipient[]> {
  const handlers = await membersOf(db, workspaceId, ["owner", "admin", "agent"]);
  let chosen = handlers;
  if (contacts.mode === "selected") {
    const ids = new Set(contacts.membershipIds);
    const selected = handlers.filter((member) => ids.has(member.membershipId));
    if (selected.length > 0) chosen = selected;
  }
  if (reason === "emergency") {
    const leads = await membersOf(db, workspaceId, ["owner", "admin"]);
    chosen = [...chosen, ...leads];
  }
  const seen = new Set<string>();
  return chosen
    .filter((member) => !seen.has(member.userId) && seen.add(member.userId))
    .map(({ userId, email, locale }) => ({ userId, email, locale }));
}

/**
 * `chat.needs_host` to the escalation contacts, at most once per 30 minutes (feature 005 FR-023).
 * During quiet hours, reasons other than emergencies and malfunctions become held notices that the
 * `chat.quiet-digest` job sends when the window ends (feature 007 FR-008).
 */
async function notifyNeedsHost(
  deps: ChatReplyDeps,
  loaded: Loaded,
  applied: AppliedSettings,
  reason: NeedsHostReason,
  guestMessage: string,
): Promise<number> {
  const { db } = deps;
  let recipients = await recipientsFor(db, loaded.workspaceId, applied.effective.contacts, reason);
  if (reason === "taken_over" && loaded.takenOverBy) {
    // Feature 006 research R10: the member who took it over, while they still handle conversations.
    const handlers = await membersOf(db, loaded.workspaceId, ["owner", "admin", "agent"]);
    const taker = handlers.filter((member) => member.userId === loaded.takenOverBy);
    if (taker.length > 0) {
      recipients = taker.map(({ userId, email, locale }) => ({ userId, email, locale }));
    }
  }
  if (applied.quiet.active && applied.quiet.endsAt && !URGENT_REASONS.has(reason)) {
    for (const recipient of recipients) {
      await db
        .insert(chatHeldNotice)
        .values({
          workspaceId: loaded.workspaceId,
          propertyId: loaded.propertyId,
          conversationId: loaded.conversationId,
          userId: recipient.userId,
          reason,
          releaseAt: applied.quiet.endsAt,
        })
        .onConflictDoUpdate({
          target: [chatHeldNotice.conversationId, chatHeldNotice.userId],
          set: { reason, releaseAt: applied.quiet.endsAt },
        });
    }
    return 0;
  }
  const claimed = await db
    .update(conversation)
    .set({ lastNotifiedAt: sql`now()` })
    .where(
      and(
        eq(conversation.id, loaded.conversationId),
        sql`(${conversation.lastNotifiedAt} IS NULL OR ${conversation.lastNotifiedAt} < now() - make_interval(mins => ${NOTIFY_EVERY_MINUTES}::int))`,
      ),
    )
    .returning({ id: conversation.id });
  if (claimed.length === 0) return 0;
  const [stayRow] = loaded.stayId
    ? await db
        .select({ checkInDate: stay.checkInDate, checkoutDate: stay.checkoutDate })
        .from(stay)
        .where(and(eq(stay.id, loaded.stayId), eq(stay.workspaceId, loaded.workspaceId)))
        .limit(1)
    : [];
  for (const recipient of recipients) {
    const rendered = await renderChatNeedsHost(recipient.locale, {
      propertyName: loaded.propertyName,
      reason: reason as ChatNeedsHostReason,
      stay: stayRow ?? null,
      guestMessage,
      conversationLink: `${deps.portalUrl}/${recipient.locale}/properties/${loaded.propertyId}/conversations/${loaded.conversationId}`,
    });
    await deps.queueEmail({ to: recipient.email, ...rendered, template: "chat.needs_host" });
    await deps.queuePush?.({
      userId: recipient.userId,
      kind: "needs_host",
      workspaceId: loaded.workspaceId,
      propertyId: loaded.propertyId,
      conversationId: loaded.conversationId,
      reason,
    });
  }
  return recipients.length;
}

/** `chat.limit_reached` to owners, once per property and day (FR-028). */
async function notifyLimit(deps: ChatReplyDeps, loaded: Loaded): Promise<void> {
  const { db } = deps;
  const claimed = await db
    .insert(chatUsageDaily)
    .values({
      workspaceId: loaded.workspaceId,
      propertyId: loaded.propertyId,
      day: sql`(now() AT TIME ZONE 'utc')::date`,
      limitNotifiedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [chatUsageDaily.propertyId, chatUsageDaily.day],
      set: { limitNotifiedAt: sql`now()` },
      setWhere: sql`${chatUsageDaily.limitNotifiedAt} IS NULL`,
    })
    .returning({ replies: chatUsageDaily.replies });
  if (claimed.length === 0) return;
  const usage = await usageToday(db, loaded.workspaceId, loaded.propertyId);
  const propertyReached = usage.property >= loaded.propertyLimit;
  for (const owner of await membersOf(db, loaded.workspaceId, ["owner"])) {
    const rendered = await renderChatLimitReached(owner.locale, {
      propertyName: propertyReached ? loaded.propertyName : null,
      limit: propertyReached ? loaded.propertyLimit : loaded.workspaceLimit,
      conversationsLink: `${deps.portalUrl}/${owner.locale}/properties/${loaded.propertyId}/conversations`,
    });
    await deps.queueEmail({ to: owner.email, ...rendered, template: "chat.limit_reached" });
  }
}

export async function runChatReply(
  deps: ChatReplyDeps,
  job: ChatReplyJob,
): Promise<ChatReplyOutcome> {
  const { db } = deps;
  const loaded = await load(db, job);
  if (!loaded) return "skipped";
  const messages = await recentMessages(db, loaded.conversationId);
  const lastReply = messages.findLastIndex((message) => message.author !== "guest");
  const batch = messages.slice(lastReply + 1);
  if (batch.length === 0) return "skipped";
  const history = messages.slice(0, lastReply + 1);
  const lastSeq = messages.at(-1)!.seq;

  if (!loaded.available) {
    // The guide closed after the guest wrote: the guest can't see a reply, the team can.
    await db
      .update(conversation)
      .set({ status: "needs_host", needsHostReason: "unavailable", doneAt: null, doneBy: null })
      .where(and(eq(conversation.id, loaded.conversationId), eq(conversation.status, "open")));
    return "unavailable";
  }

  const applied = await loadAppliedSettings(db, loaded, deps.now?.() ?? new Date());
  const outcome = await decideReply(deps, {
    context: loaded,
    language: loaded.language,
    applied,
    history: toTurns(history),
    message: batch.map((entry) => entry.body).join("\n"),
    previousWasClarify: await previousWasClarify(db, loaded, history),
    takenOver: loaded.takenOver,
  });
  const result = await write(db, loaded, lastSeq, batch, outcome, applied);
  if (!result.written) return "superseded";
  if (outcome.reason === "limit") await notifyLimit(deps, loaded);
  if (result.becameNeedsHost && outcome.reason) {
    await notifyNeedsHost(deps, loaded, applied, outcome.reason, batch.at(-1)!.body);
  }
  return outcome.decision;
}

/** The pg-boss handler: one span per job (constitution VIII), with the decision only. */
export function createChatReplyHandler(deps: ChatReplyDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<ChatReplyJob>;
      if (
        typeof data.workspaceId !== "string" ||
        typeof data.conversationId !== "string" ||
        typeof data.messageId !== "string"
      ) {
        continue;
      }
      const payload: ChatReplyJob = {
        workspaceId: data.workspaceId,
        conversationId: data.conversationId,
        messageId: data.messageId,
      };
      await runInJobSpan(
        { queue: JOB_QUEUES.chatReply, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await runChatReply(deps, payload);
          span.set({ "job.outcome": outcome });
        },
        deps.span,
      );
    }
  };
}
