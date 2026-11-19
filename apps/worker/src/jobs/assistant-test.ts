import { and, eq, sql } from "drizzle-orm";
import { agentTrace, assistantTest } from "@guidesk/db";
import { JOB_QUEUES, type AssistantTestJob } from "@guidesk/domain";
import {
  decideReply,
  loadAppliedSettings,
  loadPropertyContext,
  recordUsage,
  traceSettings,
  type Outcome,
  type PipelineDeps,
} from "./assistant-pipeline.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * "Test the assistant" (feature 007 research R12, FR-018, FR-019): runs one member question through
 * the reply pipeline with the saved settings, in dry-run mode. It writes the result, a trace marked
 * with the test, and the usage; never a conversation, message, draft, or email.
 */
export interface AssistantTestDeps extends PipelineDeps {
  span?: JobSpanDeps;
  now?: () => Date;
}

export type AssistantTestRunOutcome =
  | "sent"
  | "draft"
  | "held"
  | "pointer"
  | "greeting"
  | "limited"
  | "monthly_limited"
  | "unavailable"
  | "skipped";

function outcomeOf(outcome: Outcome): Exclude<AssistantTestRunOutcome, "skipped"> {
  switch (outcome.decision) {
    case "answered":
      return "sent";
    case "drafted":
      return "draft";
    case "pointer":
      return "pointer";
    case "greeting":
      return "greeting";
    default:
      if (outcome.reason === "limit") return "limited";
      if (outcome.reason === "monthly_limit") return "monthly_limited";
      if (outcome.reason === "unavailable") return "unavailable";
      return "held";
  }
}

export async function runAssistantTest(
  deps: AssistantTestDeps,
  job: AssistantTestJob,
): Promise<AssistantTestRunOutcome> {
  const { db } = deps;
  const [test] = await db
    .select({
      id: assistantTest.id,
      propertyId: assistantTest.propertyId,
      question: assistantTest.question,
      language: assistantTest.language,
      status: assistantTest.status,
    })
    .from(assistantTest)
    .where(and(eq(assistantTest.id, job.testId), eq(assistantTest.workspaceId, job.workspaceId)))
    .limit(1);
  if (!test || test.status !== "pending") return "skipped";

  const finish = async (values: Partial<typeof assistantTest.$inferInsert>) => {
    await db
      .update(assistantTest)
      .set({ ...values, status: "done", finishedAt: sql`now()` })
      .where(eq(assistantTest.id, test.id));
  };

  const context = await loadPropertyContext(db, job.workspaceId, test.propertyId);
  if (!context?.available) {
    await finish({ outcome: "unavailable" });
    return "unavailable";
  }
  const applied = await loadAppliedSettings(db, context, deps.now?.() ?? new Date());
  const outcome = await decideReply(deps, {
    context,
    language: test.language,
    applied,
    history: [],
    message: test.question,
    previousWasClarify: false,
  });
  const result = outcomeOf(outcome);
  await db.transaction(async (tx) => {
    await tx.insert(agentTrace).values({
      workspaceId: job.workspaceId,
      assistantTestId: test.id,
      classification: outcome.classification as Record<string, unknown> | null,
      decision: outcome.decision,
      reason: outcome.reason,
      ...traceSettings(outcome, applied),
      guideVersionId: context.publishedVersionId,
      sectionIds: outcome.sectionIds,
      checks: outcome.checks,
      model: outcome.model,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      cacheReadTokens: outcome.usage.cacheReadTokens,
      cacheWriteTokens: outcome.usage.cacheWriteTokens,
      costUsdMicros: outcome.usage.costUsdMicros,
    });
    // Tests spend the property's daily budget like guest replies (FR-019, SEC-07).
    if (outcome.usedModel) {
      await recordUsage(tx, job.workspaceId, test.propertyId, outcome.usage);
    }
  });
  await finish({
    outcome: result,
    reason: outcome.reason,
    topic: outcome.classification?.topic ?? null,
    answerKind: outcome.answerKind,
    // What the guest would see: the answer, or the holding messages; the draft for the host.
    reply: outcome.draft?.body ?? outcome.messages.map((message) => message.body).join("\n\n"),
    sectionIds: outcome.draft?.sectionIds ?? outcome.sectionIds,
  });
  return result;
}

/** The pg-boss handler: one span per job (constitution VIII), with the outcome only. */
export function createAssistantTestHandler(deps: AssistantTestDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<AssistantTestJob>;
      if (typeof data.testId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload: AssistantTestJob = { testId: data.testId, workspaceId: data.workspaceId };
      await runInJobSpan(
        { queue: JOB_QUEUES.assistantTest, workspaceId: payload.workspaceId },
        async (span) => {
          span.set({ "job.outcome": await runAssistantTest(deps, payload) });
        },
        deps.span,
      );
    }
  };
}
