import { createRequire } from "node:module";
import { and, eq, sql } from "drizzle-orm";
import {
  chatUsageDaily,
  guide,
  guideVersion,
  limitsFor,
  loadAssistantSettingsRows,
  property,
  restrictedValue,
  workspace,
  workspaceLimitInputs,
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
  levelFor,
  pointerReply,
  pointerSectionKind,
  quietWindow,
  renderKnowledge,
  resolveAssistantSettings,
  suggestionKeys,
  type AnswerKind,
  type AutonomyLevel,
  type CheckResult,
  type Classification,
  type EffectiveAssistantSettings,
  type GuideSnapshot,
  type KnowledgeInput,
  type NeedsHostReason,
  type QuietWindow,
} from "@guidesk/domain";
import type { AgentCallResult, AgentLlmPort, AgentUsage, ChatTurn } from "@guidesk/integrations";
import { exploreUrlFor, type ExploreKnowledgeDeps } from "./explore-pointer.js";
import { extrasFor } from "./extras-pointer.js";

/**
 * The assistant's decision pipeline, shared by the guest chat reply (feature 005) and "test the
 * assistant" (feature 007 research R12): budget check, classification without the guide or the
 * host's settings, the policy before the answer, the answer from the published guide with the
 * tone and the host's preferences, output checks per kind, and the policy after the answer per the
 * topic's level. It writes nothing.
 */
export interface PipelineDeps {
  db: Database;
  llm: AgentLlmPort;
  /** The guide origin: links to it always pass the link check. */
  guideUrl: string;
  classifyTimeoutMs?: number;
  answerTimeoutMs?: number;
  /** Feature 009: curated entries, so the Explore pointer follows the guest route's rules. */
  explore?: ExploreKnowledgeDeps;
}

export type ReplyLanguage = "es" | "en";

export interface PropertyContext {
  workspaceId: string;
  propertyId: string;
  propertyName: string;
  hostName: string;
  available: boolean;
  publishedVersionId: string | null;
  /** Daily budgets (feature 005 FR-028). */
  propertyLimit: number;
  workspaceLimit: number;
  /** The month's AI replies allowed by the plan or a custom limit (feature 011 FR-002). */
  monthlyLimit: number;
  country: string | null;
  timeZone: string | null;
  checkInTime: string | null;
  checkoutTime: string | null;
  maxGuests: number | null;
  address: string | null;
}

/** The settings that apply now, and whether quiet hours are on (feature 007 research R6, R8). */
export interface AppliedSettings {
  effective: EffectiveAssistantSettings;
  quiet: QuietWindow;
}

/** One message the run writes, in order. */
export interface Outgoing {
  kind: "text" | "holding" | "emergency" | "pointer" | "greeting";
  body: string;
  payload?: Record<string, unknown>;
}

export interface Outcome {
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
  /** The topic's level (feature 007 FR-020); `other` before a classification. */
  level: AutonomyLevel;
  answerKind: AnswerKind | null;
  /** Whether the answer call ran, so the host's preferences reached the model. */
  answerCalled: boolean;
}

const CLASSIFY_TIMEOUT_MS = 5_000;
const ANSWER_TIMEOUT_MS = 10_000;
/** Messages of context for classification (feature 005 research R3) and for the answer. */
const CLASSIFY_HISTORY = 6;
export const ANSWER_HISTORY = 20;

const require = createRequire(import.meta.url);
type GuestCatalog = { sections: Record<string, string> };
const SECTION_TITLES: Record<ReplyLanguage, GuestCatalog["sections"]> = {
  es: (require("@guidesk/i18n/messages/guest.es.json") as GuestCatalog).sections,
  en: (require("@guidesk/i18n/messages/guest.en.json") as GuestCatalog).sections,
};

export const NO_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsdMicros: 0,
};

export function addUsage(a: AgentUsage, b: AgentUsage): AgentUsage {
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

/** The property, its workspace's budgets, and its published guide; null when not in the workspace. */
export async function loadPropertyContext(
  db: Database,
  workspaceId: string,
  propertyId: string,
): Promise<PropertyContext | null> {
  const [row] = await db
    .select({
      propertyName: property.name,
      propertyStatus: property.status,
      country: property.country,
      timeZone: property.timeZone,
      checkInTime: property.checkInTime,
      checkoutTime: property.checkoutTime,
      maxGuests: property.maxGuests,
      addressLine1: property.addressLine1,
      addressUnit: property.addressUnit,
      city: property.city,
      hostName: workspace.name,
      workspaceStatus: workspace.status,
      propertyLimit: workspace.chatPropertyDailyLimit,
      workspaceLimit: workspace.chatDailyLimit,
      guideStatus: guide.status,
      publishedVersionId: guide.publishedVersionId,
    })
    .from(property)
    .innerJoin(workspace, eq(workspace.id, property.workspaceId))
    .leftJoin(guide, eq(guide.propertyId, property.id))
    .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  const inputs = await workspaceLimitInputs(db, workspaceId);
  const address = [row.addressLine1, row.addressUnit, row.city].filter(Boolean).join(", ");
  return {
    workspaceId,
    propertyId,
    propertyName: row.propertyName,
    hostName: hostDisplayName(row.hostName) ?? "the host",
    available:
      row.propertyStatus === "active" &&
      row.workspaceStatus === "active" &&
      row.guideStatus === "published" &&
      row.publishedVersionId !== null,
    publishedVersionId: row.publishedVersionId,
    propertyLimit: row.propertyLimit,
    workspaceLimit: row.workspaceLimit,
    monthlyLimit: inputs ? limitsFor(inputs).aiReplies.limit : 0,
    country: row.country,
    timeZone: row.timeZone,
    checkInTime: hhmm(row.checkInTime),
    checkoutTime: hhmm(row.checkoutTime),
    maxGuests: row.maxGuests,
    address: address || null,
  };
}

/** The resolved settings and the quiet window at `now` (feature 007 research R6, R8). */
export async function loadAppliedSettings(
  db: Database,
  context: Pick<PropertyContext, "workspaceId" | "propertyId" | "timeZone">,
  now: Date = new Date(),
): Promise<AppliedSettings> {
  const rows = await loadAssistantSettingsRows(db, context.workspaceId, context.propertyId);
  const effective = resolveAssistantSettings(rows.workspace, rows.property);
  return { effective, quiet: quietWindow(now, context.timeZone, effective.quietHours) };
}

/**
 * Today's (UTC) model replies for the property and the whole workspace (feature 005 R8), and the
 * workspace's replies this UTC month (feature 011 R3).
 */
export async function usageToday(
  db: Database,
  workspaceId: string,
  propertyId: string,
): Promise<{ property: number; workspace: number; month: number }> {
  const today = sql`(now() AT TIME ZONE 'utc')::date`;
  const [row] = await db
    .select({
      property: sql<number>`coalesce(sum(${chatUsageDaily.replies}) FILTER (WHERE ${chatUsageDaily.propertyId} = ${propertyId} AND ${chatUsageDaily.day} = ${today}), 0)::int`,
      workspace: sql<number>`coalesce(sum(${chatUsageDaily.replies}) FILTER (WHERE ${chatUsageDaily.day} = ${today}), 0)::int`,
      month: sql<number>`coalesce(sum(${chatUsageDaily.replies}), 0)::int`,
    })
    .from(chatUsageDaily)
    .where(
      and(
        eq(chatUsageDaily.workspaceId, workspaceId),
        sql`${chatUsageDaily.day} >= date_trunc('month', now() AT TIME ZONE 'utc')::date`,
      ),
    );
  return { property: row?.property ?? 0, workspace: row?.workspace ?? 0, month: row?.month ?? 0 };
}

/**
 * The budget that stops a model call now, if any (feature 011 R4): the month's AI replies first,
 * then the daily budgets of feature 005 (FR-028).
 */
export function budgetStop(
  usage: { property: number; workspace: number; month: number },
  context: Pick<PropertyContext, "propertyLimit" | "workspaceLimit" | "monthlyLimit">,
): "monthly" | "daily" | null {
  if (usage.month >= context.monthlyLimit) return "monthly";
  if (usage.property >= context.propertyLimit || usage.workspace >= context.workspaceLimit) {
    return "daily";
  }
  return null;
}

/** Adds one model reply to today's usage; `db` may be a transaction. */
export async function recordUsage(
  db: Pick<Database, "insert">,
  workspaceId: string,
  propertyId: string,
  usage: AgentUsage,
): Promise<void> {
  await db
    .insert(chatUsageDaily)
    .values({
      workspaceId,
      propertyId,
      day: sql`(now() AT TIME ZONE 'utc')::date`,
      replies: 1,
      costUsdMicros: usage.costUsdMicros,
    })
    .onConflictDoUpdate({
      target: [chatUsageDaily.propertyId, chatUsageDaily.day],
      set: {
        replies: sql`${chatUsageDaily.replies} + 1`,
        costUsdMicros: sql`${chatUsageDaily.costUsdMicros} + ${usage.costUsdMicros}`,
      },
    });
}

export async function knowledgeInput(
  db: Database,
  context: PropertyContext,
  language: ReplyLanguage,
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
        eq(restrictedValue.workspaceId, context.workspaceId),
        eq(restrictedValue.propertyId, context.propertyId),
      ),
    );
  const titles = SECTION_TITLES[language];
  return {
    snapshot,
    language,
    propertyName: context.propertyName,
    facts: {
      checkInTime: context.checkInTime,
      checkoutTime: context.checkoutTime,
      maxGuests: context.maxGuests,
      address: context.address,
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
    emergencyNumber: emergencyNumberFor(context.country),
  };
}

/** The settings columns of a trace (feature 007 FR-020). */
export function traceSettings(outcome: Outcome, applied: AppliedSettings) {
  const { effective } = applied;
  return {
    autonomy: outcome.level,
    autonomySource: effective.sources.autonomy,
    answerKind: outcome.answerKind,
    tone: effective.tone,
    quietHours: applied.quiet.active,
    workspaceInstructionVersionId: outcome.answerCalled
      ? (effective.instructions.workspace?.versionId ?? null)
      : null,
    propertyInstructionVersionId: outcome.answerCalled
      ? (effective.instructions.property?.versionId ?? null)
      : null,
  };
}

export interface DecideInput {
  context: PropertyContext;
  language: ReplyLanguage;
  applied: AppliedSettings;
  history: ChatTurn[];
  message: string;
  /** The previous assistant reply was a clarifying question (never two in a row, FR-004). */
  previousWasClarify: boolean;
  /**
   * Feature 006 research R4: a member took the conversation over. Only an emergency gets messages
   * (the emergency card and its holding reply); anything else needs the team with no message.
   */
  takenOver?: boolean;
}

/** Runs the model calls and the policy; writes nothing (feature 005 R5, feature 007 R2). */
export async function decideReply(deps: PipelineDeps, input: DecideInput): Promise<Outcome> {
  const { db, llm } = deps;
  const { context, language, applied, message } = input;
  const { effective, quiet } = applied;
  const tone = effective.tone;
  const style = { tone, quietUntil: quiet.active ? quiet.endsAtLocal : null };

  const held = (reason: NeedsHostReason, extra: Partial<Outcome> = {}): Outcome => ({
    decision: "held",
    reason,
    messages: [{ kind: "holding", body: holdingReply(language, reason, style) }],
    classification: null,
    sectionIds: [],
    checks: [],
    draft: null,
    model: null,
    usage: NO_USAGE,
    usedModel: false,
    level: levelFor(effective.autonomy, "other"),
    answerKind: null,
    answerCalled: false,
    ...extra,
  });

  // Taken over: no assistant message, the conversation waits for the member (feature 006 R4).
  const silent = (extra: Partial<Outcome> = {}): Outcome => ({
    ...held("taken_over", extra),
    messages: [],
  });

  const stop = budgetStop(await usageToday(db, context.workspaceId, context.propertyId), context);
  if (stop) {
    // Over a budget: a holding reply without any model call (feature 005 FR-028, feature 011).
    return input.takenOver ? silent() : held(stop === "monthly" ? "monthly_limit" : "limit");
  }

  let classified: AgentCallResult<Classification>;
  try {
    // Classification never sees the guide, the tone, or the host's preferences (FR-013).
    classified = await llm.classifyGuestMessage(
      { history: input.history.slice(-CLASSIFY_HISTORY), message },
      { signal: AbortSignal.timeout(deps.classifyTimeoutMs ?? CLASSIFY_TIMEOUT_MS) },
    );
  } catch {
    return input.takenOver ? silent() : held("unavailable");
  }
  let spent = classified.usage;
  const modelOf = { model: classified.model, usedModel: true };
  if (classified.outcome !== "ok" || !classified.result) {
    // A refusal or invalid output counts as "not confident", with no draft (edge cases).
    if (input.takenOver) return silent({ ...modelOf, usage: spent });
    return held("not_confident", { ...modelOf, usage: spent });
  }
  const classification = classified.result;
  const level = levelFor(effective.autonomy, classification.topic);
  const base = { classification, level, ...modelOf };

  const before = decideBeforeAnswer(classification, false);
  const [version] = await db
    .select({ snapshot: guideVersion.snapshot })
    .from(guideVersion)
    .where(
      and(
        eq(guideVersion.id, context.publishedVersionId!),
        eq(guideVersion.workspaceId, context.workspaceId),
      ),
    )
    .limit(1);
  if (!version) {
    return input.takenOver
      ? silent({ ...base, usage: spent })
      : held("unavailable", { ...base, usage: spent });
  }
  const snapshot = version.snapshot as GuideSnapshot;
  const knowledgeIn = await knowledgeInput(db, context, language, snapshot);
  // Feature 009 (research R11): the guide chat may point to Explore; copilot drafts never do.
  knowledgeIn.exploreUrl = await exploreUrlFor(
    db,
    context,
    language,
    snapshot,
    deps.guideUrl,
    deps.explore,
  );
  // Feature 008 (research R8): the host's extras and the Extras page; copilot drafts never get them.
  const extras = await extrasFor(db, context, language, deps.guideUrl);
  knowledgeIn.extras = extras?.extras ?? null;
  knowledgeIn.extrasUrl = extras?.extrasUrl ?? null;
  if (input.takenOver && !(before.kind === "hold" && before.emergency)) {
    return silent({ ...base, usage: spent });
  }

  if (before.kind === "hold") {
    const messages: Outgoing[] = [];
    if (before.emergency) {
      // The emergency card comes before any other text (FR-018), quoting only the guide.
      messages.push({
        kind: "emergency",
        body: emergencyReply(language, knowledgeIn.emergencyNumber, tone),
        payload: {
          emergency: { number: knowledgeIn.emergencyNumber, text: emergencyText(knowledgeIn) },
        },
      });
    }
    messages.push({ kind: "holding", body: holdingReply(language, before.reason, style) });
    return { ...held(before.reason, { ...base, usage: spent }), messages };
  }

  if (before.kind === "pointer") {
    const kind = pointerSectionKind(classification.topic);
    const section = snapshot.sections.find((candidate) => candidate.kind === kind);
    const title = section ? knowledgeIn.sectionTitle(section.kind, null) : null;
    return {
      ...held("not_confident", { ...base, usage: spent }),
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
      ...held("not_confident", { ...base, usage: spent }),
      decision: "greeting",
      reason: null,
      messages: [
        {
          kind: "greeting",
          body: greetingReply(language, context.propertyName, tone),
          payload: { suggestions: suggestionKeys(snapshot) },
        },
      ],
    };
  }

  const knowledge = renderKnowledge(knowledgeIn);
  let answered;
  try {
    answered = await llm.answerGuest(
      {
        propertyName: context.propertyName,
        hostName: context.hostName,
        knowledge: knowledge.text,
        history: input.history.slice(-ANSWER_HISTORY),
        message,
        language: classification.language,
        tone,
        preferences: {
          workspace: effective.instructions.workspace?.text ?? null,
          property: effective.instructions.property?.text ?? null,
        },
      },
      { signal: AbortSignal.timeout(deps.answerTimeoutMs ?? ANSWER_TIMEOUT_MS) },
    );
  } catch {
    return held("unavailable", { ...base, usage: spent, answerCalled: true });
  }
  spent = addUsage(spent, answered.usage);
  const withAnswer = { ...base, usage: spent, model: answered.model, answerCalled: true };
  if (answered.outcome !== "ok" || !answered.result) {
    return held("not_confident", withAnswer);
  }
  const answer = answered.result;
  const known = new Set(knowledge.sections.map((section) => section.id));
  const sectionIds = answer.sectionIds.filter((id) => known.has(id));
  const checks = checkAnswer(
    { text: answer.answer, sectionIds: answer.sectionIds, kind: answer.kind },
    { knowledgeText: knowledge.text, sectionIds: known, guideOrigin: deps.guideUrl },
  );
  const after = decideAfterAnswer(answer, level, allPassed(checks), input.previousWasClarify);
  const kindOf = { answerKind: answer.kind };
  if (after.kind === "send") {
    const sections = knowledge.sections
      .filter((section) => sectionIds.includes(section.id))
      .map((section) => ({ id: section.id, title: section.title }));
    return {
      ...withAnswer,
      ...kindOf,
      decision: "answered",
      reason: null,
      messages: [{ kind: "text", body: answer.answer, payload: { sections } }],
      sectionIds,
      checks,
      draft: null,
    };
  }
  return {
    ...held(after.reason, withAnswer),
    ...kindOf,
    decision: "drafted",
    sectionIds,
    checks,
    draft: { body: answer.answer, sectionIds },
  };
}
