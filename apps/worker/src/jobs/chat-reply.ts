import { createRequire } from "node:module";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  agentDraft,
  agentTrace,
  chatMessage,
  chatUsageDaily,
  conversation,
  guide,
  guideVersion,
  membership,
  property,
  restrictedValue,
  stay,
  user,
  workspace,
  type Database,
} from "@guidesk/db";
import {
  allPassed,
  checkAnswer,
  decideAfterAnswer,
  decideBeforeAnswer,
  emergencyNumberFor,
  emergencyReply,
  emergencyText,
  greetingReply,
  holdingReply,
  hostDisplayName,
  JOB_QUEUES,
  pointerReply,
  pointerSectionKind,
  renderKnowledge,
  suggestionKeys,
  type Autonomy,
  type ChatReplyJob,
  type CheckResult,
  type Classification,
  type GuideSnapshot,
  type KnowledgeInput,
  type NeedsHostReason,
} from "@guidesk/domain";
import {
  renderChatLimitReached,
  renderChatNeedsHost,
  toEmailLocale,
  type ChatNeedsHostReason,
} from "@guidesk/emails";
import type {
  AgentCallResult,
  AgentLlmPort,
  AgentUsage,
  ChatTurn,
  EmailMessage,
} from "@guidesk/integrations";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * The assistant's reply to a guest (feature 005 research R2 to R6, R8, R9, R12): budget check,
 * classification without the guide, the policy decision, the answer from the published guide,
 * output checks, then the reply, holding reply, or draft, with a trace for every output. Runs in
 * the system context; every query names the job's workspace.
 */
export interface ChatReplyDeps {
  db: Database;
  llm: AgentLlmPort;
  queueEmail: (message: EmailMessage) => Promise<void>;
  portalUrl: string;
  /** The guide origin: links to it always pass the link check (research R6). */
  guideUrl: string;
  span?: JobSpanDeps;
  /** Deadlines (FR-029); tests shorten them. */
  classifyTimeoutMs?: number;
  answerTimeoutMs?: number;
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

const CLASSIFY_TIMEOUT_MS = 5_000;
const ANSWER_TIMEOUT_MS = 10_000;
/** Messages of context for classification (research R3) and for the answer. */
const CLASSIFY_HISTORY = 6;
const ANSWER_HISTORY = 20;
const NOTIFY_EVERY_MINUTES = 30;

const require = createRequire(import.meta.url);
type GuestCatalog = { sections: Record<string, string> };
const SECTION_TITLES: Record<"es" | "en", GuestCatalog["sections"]> = {
  es: (require("@guidesk/i18n/messages/guest.es.json") as GuestCatalog).sections,
  en: (require("@guidesk/i18n/messages/guest.en.json") as GuestCatalog).sections,
};

interface Loaded {
  conversationId: string;
  workspaceId: string;
  propertyId: string;
  status: "open" | "needs_host";
  language: "es" | "en";
  stayId: string | null;
  propertyName: string;
  hostName: string;
  autonomy: Autonomy;
  available: boolean;
  publishedVersionId: string | null;
  propertyLimit: number;
  workspaceLimit: number;
  country: string | null;
  checkInTime: string | null;
  checkoutTime: string | null;
  maxGuests: number | null;
  address: string | null;
}

interface StoredMessage {
  id: string;
  seq: number;
  author: "guest" | "assistant" | "host";
  body: string;
}

/** One message the run writes, in order. */
interface Outgoing {
  kind: "text" | "holding" | "emergency" | "pointer" | "greeting";
  body: string;
  payload?: Record<string, unknown>;
}

interface Outcome {
  decision: "answered" | "drafted" | "held" | "pointer" | "greeting";
  reason: NeedsHostReason | null;
  messages: Outgoing[];
  classification: Classification | null;
  sectionIds: string[];
  checks: CheckResult[];
  draft: { body: string; sectionIds: string[] } | null;
  model: string | null;
  usage: AgentUsage;
  usedModel: boolean;
}

const NO_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsdMicros: 0,
};

function addUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsdMicros: a.costUsdMicros + b.costUsdMicros,
  };
}

function hhmm(time: string | null): string | null {
  return time ? time.slice(0, 5) : null;
}

async function load(db: Database, job: ChatReplyJob): Promise<Loaded | null> {
  const [row] = await db
    .select({
      conversationId: conversation.id,
      workspaceId: conversation.workspaceId,
      propertyId: conversation.propertyId,
      status: conversation.status,
      language: conversation.language,
      stayId: conversation.stayId,
      propertyName: property.name,
      propertyStatus: property.status,
      propertyAutonomy: property.assistantAutonomy,
      country: property.country,
      checkInTime: property.checkInTime,
      checkoutTime: property.checkoutTime,
      maxGuests: property.maxGuests,
      addressLine1: property.addressLine1,
      addressUnit: property.addressUnit,
      city: property.city,
      hostName: workspace.name,
      workspaceStatus: workspace.status,
      workspaceAutonomy: workspace.assistantAutonomy,
      propertyLimit: workspace.chatPropertyDailyLimit,
      workspaceLimit: workspace.chatDailyLimit,
      guideStatus: guide.status,
      publishedVersionId: guide.publishedVersionId,
    })
    .from(conversation)
    .innerJoin(property, eq(property.id, conversation.propertyId))
    .innerJoin(workspace, eq(workspace.id, conversation.workspaceId))
    .leftJoin(guide, eq(guide.propertyId, conversation.propertyId))
    .where(
      and(eq(conversation.id, job.conversationId), eq(conversation.workspaceId, job.workspaceId)),
    )
    .limit(1);
  if (!row) return null;
  const address = [row.addressLine1, row.addressUnit, row.city].filter(Boolean).join(", ");
  return {
    conversationId: row.conversationId,
    workspaceId: row.workspaceId,
    propertyId: row.propertyId,
    status: row.status,
    language: row.language,
    stayId: row.stayId,
    propertyName: row.propertyName,
    hostName: hostDisplayName(row.hostName) ?? "the host",
    autonomy: row.propertyAutonomy ?? row.workspaceAutonomy,
    available:
      row.propertyStatus === "active" &&
      row.workspaceStatus === "active" &&
      row.guideStatus === "published" &&
      row.publishedVersionId !== null,
    publishedVersionId: row.publishedVersionId,
    propertyLimit: row.propertyLimit,
    workspaceLimit: row.workspaceLimit,
    country: row.country,
    checkInTime: hhmm(row.checkInTime),
    checkoutTime: hhmm(row.checkoutTime),
    maxGuests: row.maxGuests,
    address: address || null,
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

/** Today's (UTC) model replies for the property and the whole workspace (research R8). */
async function usageToday(
  db: Database,
  workspaceId: string,
  propertyId: string,
): Promise<{ property: number; workspace: number }> {
  const [row] = await db
    .select({
      property: sql<number>`coalesce(sum(${chatUsageDaily.replies}) FILTER (WHERE ${chatUsageDaily.propertyId} = ${propertyId}), 0)::int`,
      workspace: sql<number>`coalesce(sum(${chatUsageDaily.replies}), 0)::int`,
    })
    .from(chatUsageDaily)
    .where(
      and(
        eq(chatUsageDaily.workspaceId, workspaceId),
        sql`${chatUsageDaily.day} = (now() AT TIME ZONE 'utc')::date`,
      ),
    );
  return { property: row?.property ?? 0, workspace: row?.workspace ?? 0 };
}

function toTurns(messages: readonly StoredMessage[]): ChatTurn[] {
  return messages.map((message) => ({ role: message.author, text: message.body }));
}

async function knowledgeInput(
  db: Database,
  loaded: Loaded,
  snapshot: GuideSnapshot,
): Promise<KnowledgeInput> {
  // Labels and public values only: the ciphertext column is never selected (SEC-06).
  const fields = await db
    .select({
      id: restrictedValue.id,
      label: restrictedValue.label,
      publicValue: restrictedValue.publicValue,
    })
    .from(restrictedValue)
    .where(
      and(
        eq(restrictedValue.workspaceId, loaded.workspaceId),
        eq(restrictedValue.propertyId, loaded.propertyId),
      ),
    );
  const titles = SECTION_TITLES[loaded.language];
  return {
    snapshot,
    language: loaded.language,
    propertyName: loaded.propertyName,
    facts: {
      checkInTime: loaded.checkInTime,
      checkoutTime: loaded.checkoutTime,
      maxGuests: loaded.maxGuests,
      address: loaded.address,
    },
    lockedLabels: new Map(
      fields.filter((field) => field.publicValue === null).map((field) => [field.id, field.label]),
    ),
    publicValues: new Map(
      fields
        .filter((field) => field.publicValue !== null)
        .map((field) => [field.id, field.publicValue!]),
    ),
    sectionTitle: (kind, customTitle) => customTitle ?? titles[kind] ?? titles.custom ?? kind,
    emergencyNumber: emergencyNumberFor(loaded.country),
  };
}

function held(
  language: "es" | "en",
  reason: NeedsHostReason,
  extra: Partial<Outcome> = {},
): Outcome {
  return {
    decision: "held",
    reason,
    messages: [{ kind: "holding", body: holdingReply(language, reason) }],
    classification: null,
    sectionIds: [],
    checks: [],
    draft: null,
    model: null,
    usage: NO_USAGE,
    usedModel: false,
    ...extra,
  };
}

/** Runs the model calls and the policy; writes nothing (research R5). */
async function decide(
  deps: ChatReplyDeps,
  loaded: Loaded,
  history: StoredMessage[],
  batch: StoredMessage[],
): Promise<Outcome> {
  const { db, llm } = deps;
  const language = loaded.language;
  const message = batch.map((entry) => entry.body).join("\n");

  const usage = await usageToday(db, loaded.workspaceId, loaded.propertyId);
  if (usage.property >= loaded.propertyLimit || usage.workspace >= loaded.workspaceLimit) {
    // Over a budget: a holding reply without any model call (FR-028).
    return held(language, "limit");
  }

  let classified: AgentCallResult<Classification>;
  try {
    classified = await llm.classifyGuestMessage(
      { history: toTurns(history.slice(-CLASSIFY_HISTORY)), message },
      { signal: AbortSignal.timeout(deps.classifyTimeoutMs ?? CLASSIFY_TIMEOUT_MS) },
    );
  } catch {
    return held(language, "unavailable");
  }
  let spent = classified.usage;
  const modelOf = { model: classified.model, usedModel: true };
  if (classified.outcome !== "ok" || !classified.result) {
    // A refusal or invalid output counts as "not confident", with no draft (edge cases).
    return held(language, "not_confident", { ...modelOf, usage: spent });
  }
  const classification = classified.result;
  const base = { classification, ...modelOf };

  const before = decideBeforeAnswer(classification, false);
  const [version] = await db
    .select({ snapshot: guideVersion.snapshot })
    .from(guideVersion)
    .where(
      and(
        eq(guideVersion.id, loaded.publishedVersionId!),
        eq(guideVersion.workspaceId, loaded.workspaceId),
      ),
    )
    .limit(1);
  if (!version) return held(language, "unavailable", { ...base, usage: spent });
  const snapshot = version.snapshot as GuideSnapshot;
  const input = await knowledgeInput(db, loaded, snapshot);

  if (before.kind === "hold") {
    const messages: Outgoing[] = [];
    if (before.emergency) {
      // The emergency card comes before any other text (FR-018), quoting only the guide.
      messages.push({
        kind: "emergency",
        body: emergencyReply(language, input.emergencyNumber),
        payload: {
          emergency: { number: input.emergencyNumber, text: emergencyText(input) },
        },
      });
    }
    messages.push({ kind: "holding", body: holdingReply(language, before.reason) });
    return { ...held(language, before.reason, { ...base, usage: spent }), messages };
  }

  if (before.kind === "pointer") {
    const kind = pointerSectionKind(classification.topic);
    const section = snapshot.sections.find((candidate) => candidate.kind === kind);
    const title = section ? input.sectionTitle(section.kind, null) : null;
    return {
      ...held(language, "not_confident", { ...base, usage: spent }),
      decision: "pointer",
      reason: null,
      messages: [
        {
          kind: "pointer",
          body: pointerReply(language, title),
          payload: section ? { sections: [{ id: section.id, title }] } : {},
        },
      ],
      sectionIds: section ? [section.id] : [],
    };
  }

  if (before.kind === "greeting") {
    return {
      ...held(language, "not_confident", { ...base, usage: spent }),
      decision: "greeting",
      reason: null,
      messages: [
        {
          kind: "greeting",
          body: greetingReply(language, loaded.propertyName),
          payload: { suggestions: suggestionKeys(snapshot) },
        },
      ],
    };
  }

  const knowledge = renderKnowledge(input);
  let answered;
  try {
    answered = await llm.answerGuest(
      {
        propertyName: loaded.propertyName,
        hostName: loaded.hostName,
        knowledge: knowledge.text,
        history: toTurns(history.slice(-ANSWER_HISTORY)),
        message,
        language: classification.language,
      },
      { signal: AbortSignal.timeout(deps.answerTimeoutMs ?? ANSWER_TIMEOUT_MS) },
    );
  } catch {
    return held(language, "unavailable", { ...base, usage: spent });
  }
  spent = addUsage(spent, answered.usage);
  const withAnswer = { ...base, usage: spent, model: answered.model };
  if (answered.outcome !== "ok" || !answered.result) {
    return held(language, "not_confident", withAnswer);
  }
  const answer = answered.result;
  const known = new Set(knowledge.sections.map((section) => section.id));
  const sectionIds = answer.sectionIds.filter((id) => known.has(id));
  const checks = checkAnswer(
    { text: answer.answer, sectionIds: answer.sectionIds },
    { knowledgeText: knowledge.text, sectionIds: known, guideOrigin: deps.guideUrl },
  );
  const after = decideAfterAnswer(answer, loaded.autonomy, allPassed(checks));
  if (after.kind === "send") {
    const sections = knowledge.sections
      .filter((section) => sectionIds.includes(section.id))
      .map((section) => ({ id: section.id, title: section.title }));
    return {
      ...withAnswer,
      decision: "answered",
      reason: null,
      messages: [{ kind: "text", body: answer.answer, payload: { sections } }],
      sectionIds,
      checks,
      draft: null,
    };
  }
  return {
    ...held(language, after.reason, withAnswer),
    decision: "drafted",
    sectionIds,
    checks,
    draft: { body: answer.answer, sectionIds },
  };
}

/** Writes the run's messages, status, draft, trace, and usage in one transaction. */
async function write(
  db: Database,
  loaded: Loaded,
  lastSeq: number,
  batch: StoredMessage[],
  outcome: Outcome,
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
    const recordUsage = async () => {
      if (!outcome.usedModel) return;
      await tx
        .insert(chatUsageDaily)
        .values({
          workspaceId: loaded.workspaceId,
          propertyId: loaded.propertyId,
          day: sql`(now() AT TIME ZONE 'utc')::date`,
          replies: 1,
          costUsdMicros: outcome.usage.costUsdMicros,
        })
        .onConflictDoUpdate({
          target: [chatUsageDaily.propertyId, chatUsageDaily.day],
          set: {
            replies: sql`${chatUsageDaily.replies} + 1`,
            costUsdMicros: sql`${chatUsageDaily.costUsdMicros} + ${outcome.usage.costUsdMicros}`,
          },
        });
    };
    if (!locked || (current?.seq ?? 0) !== lastSeq) {
      // Someone wrote meanwhile (the guest again, or a member): the queued run answers it all.
      await recordUsage();
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
        ...(needsHost ? { status: "needs_host" as const, needsHostReason: outcome.reason } : {}),
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
        autonomy: loaded.autonomy,
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
    await recordUsage();
    return { written: true, becameNeedsHost: needsHost };
  });
}

async function handlersOf(
  db: Database,
  workspaceId: string,
  roles: ("owner" | "admin" | "agent")[],
): Promise<{ email: string; locale: "es" | "en" }[]> {
  const rows = await db
    .select({ email: user.email, preferredLanguage: user.preferredLanguage })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.workspaceId, workspaceId), inArray(membership.role, roles)));
  return rows.map((row) => ({ email: row.email, locale: toEmailLocale(row.preferredLanguage) }));
}

/** `chat.needs_host` to owners, admins, and agents, at most once per 30 minutes (FR-023). */
async function notifyNeedsHost(
  deps: ChatReplyDeps,
  loaded: Loaded,
  reason: NeedsHostReason,
  guestMessage: string,
): Promise<number> {
  const { db } = deps;
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
  const recipients = await handlersOf(db, loaded.workspaceId, ["owner", "admin", "agent"]);
  for (const recipient of recipients) {
    const rendered = await renderChatNeedsHost(recipient.locale, {
      propertyName: loaded.propertyName,
      reason: reason as ChatNeedsHostReason,
      stay: stayRow ?? null,
      guestMessage,
      conversationLink: `${deps.portalUrl}/${recipient.locale}/properties/${loaded.propertyId}/conversations/${loaded.conversationId}`,
    });
    await deps.queueEmail({ to: recipient.email, ...rendered, template: "chat.needs_host" });
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
  for (const owner of await handlersOf(db, loaded.workspaceId, ["owner"])) {
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
      .set({ status: "needs_host", needsHostReason: "unavailable" })
      .where(and(eq(conversation.id, loaded.conversationId), eq(conversation.status, "open")));
    return "unavailable";
  }

  const outcome = await decide(deps, loaded, history, batch);
  const result = await write(db, loaded, lastSeq, batch, outcome);
  if (!result.written) return "superseded";
  if (outcome.reason === "limit") await notifyLimit(deps, loaded);
  if (result.becameNeedsHost && outcome.reason) {
    await notifyNeedsHost(deps, loaded, outcome.reason, batch.at(-1)!.body);
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
