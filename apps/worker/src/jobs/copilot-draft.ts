import { and, eq, sql } from "drizzle-orm";
import { agentTrace, copilotRun, guideVersion } from "@guidesk/db";
import {
  cautionFor,
  checkAnswer,
  copilotCodeDraft,
  copilotEmergencyDraft,
  JOB_QUEUES,
  levelFor,
  pointerSectionKind,
  removeContactDetails,
  renderKnowledge,
  withoutBenefitRecommendations,
  type CheckResult,
  type Classification,
  type CopilotDraftJob,
  type GuideSnapshot,
} from "@guidesk/domain";
import type { AgentUsage } from "@guidesk/integrations";
import {
  addUsage,
  knowledgeInput,
  loadAppliedSettings,
  loadPropertyContext,
  NO_USAGE,
  recordUsage,
  usageToday,
  type PipelineDeps,
} from "./assistant-pipeline.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * The paste-to-reply copilot (feature 006 research R5, R6, FR-009 to FR-014): a host-voice draft for
 * a platform chat from the published guide, with the tone and instructions; classification first;
 * fixed texts for emergencies and code requests; recommendations with a benefit left out (PC-10);
 * links and contact details removed for inquiries (PC-05); the same checks as automatic messages;
 * a trace and the usage. It creates no conversation and sends nothing.
 */
export interface CopilotDraftDeps extends PipelineDeps {
  span?: JobSpanDeps;
  now?: () => Date;
}

export type CopilotRunOutcome = "drafted" | "limited" | "unavailable" | "failed" | "skipped";

const CLASSIFY_TIMEOUT_MS = 5_000;
const ANSWER_TIMEOUT_MS = 10_000;

interface Result {
  outcome: "drafted" | "limited" | "unavailable" | "failed";
  draft: string | null;
  sectionIds: string[];
  checks: CheckResult[];
  removed: string[];
  caution: string | null;
  covered: boolean | null;
  classification: Classification | null;
  answerKind: string | null;
  model: string | null;
  usage: AgentUsage;
  usedModel: boolean;
}

const EMPTY: Result = {
  outcome: "failed",
  draft: null,
  sectionIds: [],
  checks: [],
  removed: [],
  caution: null,
  covered: null,
  classification: null,
  answerKind: null,
  model: null,
  usage: NO_USAGE,
  usedModel: false,
};

export async function runCopilotDraft(
  deps: CopilotDraftDeps,
  job: CopilotDraftJob,
): Promise<CopilotRunOutcome> {
  const { db, llm } = deps;
  const [run] = await db
    .select()
    .from(copilotRun)
    .where(and(eq(copilotRun.id, job.runId), eq(copilotRun.workspaceId, job.workspaceId)))
    .limit(1);
  if (!run || run.status !== "pending") return "skipped";

  const finish = async (
    result: Result,
    applied?: Awaited<ReturnType<typeof loadAppliedSettings>>,
  ) => {
    await db.transaction(async (tx) => {
      if (result.usedModel || result.outcome === "drafted") {
        await tx.insert(agentTrace).values({
          workspaceId: job.workspaceId,
          copilotRunId: run.id,
          classification: result.classification as Record<string, unknown> | null,
          decision: "drafted",
          reason: null,
          autonomy: applied
            ? levelFor(applied.effective.autonomy, result.classification?.topic ?? "other")
            : "draft",
          autonomySource: applied?.effective.sources.autonomy ?? null,
          answerKind: result.answerKind as "grounded" | "general" | "clarify" | null,
          tone: applied?.effective.tone ?? null,
          workspaceInstructionVersionId:
            applied?.effective.instructions.workspace?.versionId ?? null,
          propertyInstructionVersionId: applied?.effective.instructions.property?.versionId ?? null,
          sectionIds: result.sectionIds,
          checks: result.checks,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cacheReadTokens: result.usage.cacheReadTokens,
          cacheWriteTokens: result.usage.cacheWriteTokens,
          costUsdMicros: result.usage.costUsdMicros,
        });
      }
      // Copilot drafts spend the property's daily AI budget like guest replies (FR-014).
      if (result.usedModel) await recordUsage(tx, job.workspaceId, run.propertyId, result.usage);
      await tx
        .update(copilotRun)
        .set({
          status: "done",
          outcome: result.outcome,
          draft: result.draft,
          sectionIds: result.sectionIds,
          checks: result.checks,
          removed: result.removed,
          caution: result.caution,
          covered: result.covered,
          topic: result.classification?.topic ?? null,
          answerKind: result.answerKind,
          finishedAt: sql`now()`,
        })
        .where(eq(copilotRun.id, run.id));
    });
    return result.outcome;
  };

  const context = await loadPropertyContext(db, job.workspaceId, run.propertyId);
  if (!context?.available) return finish({ ...EMPTY, outcome: "unavailable" });
  const applied = await loadAppliedSettings(db, context, deps.now?.() ?? new Date());
  const usage = await usageToday(db, context.workspaceId, context.propertyId);
  if (usage.property >= context.propertyLimit || usage.workspace >= context.workspaceLimit) {
    return finish({ ...EMPTY, outcome: "limited" }, applied);
  }

  let classified;
  try {
    classified = await llm.classifyGuestMessage(
      { history: [], message: run.message },
      { signal: AbortSignal.timeout(deps.classifyTimeoutMs ?? CLASSIFY_TIMEOUT_MS) },
    );
  } catch {
    return finish({ ...EMPTY, outcome: "unavailable" }, applied);
  }
  const modelOf = { model: classified.model, usedModel: true, usage: classified.usage };
  if (classified.outcome !== "ok" || !classified.result) {
    return finish({ ...EMPTY, ...modelOf, outcome: "failed" }, applied);
  }
  const classification = classified.result;
  // Fixed texts follow the guest's language when it is one of ours, else the member's screen.
  const language = classification.language.startsWith("en")
    ? "en"
    : classification.language.startsWith("es")
      ? "es"
      : run.language;
  const tone = applied.effective.tone;
  const caution = cautionFor(classification.escalation);
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
  if (!version) return finish({ ...EMPTY, ...modelOf, outcome: "unavailable" }, applied);
  const snapshot = withoutBenefitRecommendations(version.snapshot as GuideSnapshot);
  const knowledgeIn = await knowledgeInput(db, context, language, snapshot);
  const knowledge = renderKnowledge(knowledgeIn);
  const known = new Set(knowledge.sections.map((section) => section.id));
  const checkContext = {
    knowledgeText: knowledge.text,
    sectionIds: known,
    guideOrigin: deps.guideUrl,
  };
  const fixed = (draft: string, sectionIds: string[] = []): Result => ({
    ...EMPTY,
    ...modelOf,
    outcome: "drafted",
    draft,
    sectionIds,
    checks: checkAnswer({ text: draft, sectionIds, kind: "general" }, checkContext).filter(
      (check) => check.check !== "price",
    ),
    caution,
    covered: true,
    classification,
  });

  if (classification.escalation === "emergency") {
    return finish(
      fixed(copilotEmergencyDraft(language, knowledgeIn.emergencyNumber, tone)),
      applied,
    );
  }
  if (classification.escalation === "sensitive_request") {
    const kind = pointerSectionKind(classification.topic);
    const section = snapshot.sections.find((candidate) => candidate.kind === kind);
    const title = section ? knowledgeIn.sectionTitle(section.kind, null) : null;
    return finish(
      fixed(
        copilotCodeDraft(language, run.bookingStatus, title, tone),
        section ? [section.id] : [],
      ),
      applied,
    );
  }

  let answered;
  try {
    answered = await llm.answerGuest(
      {
        propertyName: context.propertyName,
        hostName: context.hostName,
        knowledge: knowledge.text,
        history: [],
        message: run.message,
        language: classification.language,
        tone,
        preferences: {
          workspace: applied.effective.instructions.workspace?.text ?? null,
          property: applied.effective.instructions.property?.text ?? null,
        },
        channel: "platform",
        bookingStatus: run.bookingStatus,
      },
      { signal: AbortSignal.timeout(deps.answerTimeoutMs ?? ANSWER_TIMEOUT_MS) },
    );
  } catch {
    return finish({ ...EMPTY, ...modelOf, outcome: "unavailable", classification }, applied);
  }
  const spent = addUsage(classified.usage, answered.usage);
  if (answered.outcome !== "ok" || !answered.result) {
    return finish(
      {
        ...EMPTY,
        ...modelOf,
        usage: spent,
        model: answered.model,
        outcome: "failed",
        classification,
      },
      applied,
    );
  }
  const answer = answered.result;
  const cleaned =
    run.bookingStatus === "inquiry"
      ? removeContactDetails(answer.answer)
      : { text: answer.answer, removed: [] };
  const sectionIds = answer.sectionIds.filter((id) => known.has(id));
  return finish(
    {
      ...EMPTY,
      outcome: "drafted",
      draft: cleaned.text,
      sectionIds,
      checks: checkAnswer(
        { text: cleaned.text, sectionIds: answer.sectionIds, kind: answer.kind },
        checkContext,
      ),
      removed: cleaned.removed,
      caution,
      covered: answer.answerable && !answer.needsHost,
      classification,
      answerKind: answer.kind,
      model: answered.model,
      usage: spent,
      usedModel: true,
    },
    applied,
  );
}

/** The pg-boss handler: one span per job with the outcome only. */
export function createCopilotDraftHandler(deps: CopilotDraftDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<CopilotDraftJob>;
      if (typeof data.runId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload: CopilotDraftJob = { runId: data.runId, workspaceId: data.workspaceId };
      await runInJobSpan(
        { queue: JOB_QUEUES.copilotDraft, workspaceId: payload.workspaceId },
        async (span) => {
          span.set({ "job.outcome": await runCopilotDraft(deps, payload) });
        },
        deps.span,
      );
    }
  };
}
