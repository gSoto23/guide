import { and, eq, ne } from "drizzle-orm";
import { extractionRequest, upload, type Database } from "@guidesk/db";
import {
  JOB_QUEUES,
  processExtractionOutput,
  redactRestrictedValues,
  type ExtractionRunJob,
} from "@guidesk/domain";
import { LlmTimeoutError, type LlmPort, type SandboxPort } from "@guidesk/integrations";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Listing extraction (feature 002 US2, research R3, R4, R6, T059). Screenshots are recognized in
 * parallel by the sandbox's file processor (images never reach the model), the recognized text is
 * redacted, and one model call runs on the combined redacted text. The whole job has 60 seconds
 * (FR-016); the input is kept on failure so "Try again" can reuse it.
 */
export const EXTRACTION_DEADLINE_MS = 60_000;

export interface ExtractionDeps {
  db: Database;
  sandbox: SandboxPort;
  llm: LlmPort;
  now?: () => Date;
  deadlineMs?: number;
  span?: JobSpanDeps;
}

export type ExtractionOutcome =
  "skipped" | "succeeded" | "timeout" | "ai_unavailable" | "nothing_found";

function mergeCounts(
  a: Record<string, number>,
  b: Partial<Record<string, number>>,
): Record<string, number> {
  const merged = { ...a };
  for (const [kind, count] of Object.entries(b)) merged[kind] = (merged[kind] ?? 0) + (count ?? 0);
  return merged;
}

/** Rejects when the signal aborts, so a slow step cannot outlive the deadline. */
function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new LlmTimeoutError());
      return;
    }
    signal.addEventListener("abort", () => reject(new LlmTimeoutError()), { once: true });
    promise.then(resolve, reject);
  });
}

export async function runExtraction(
  deps: ExtractionDeps,
  job: ExtractionRunJob,
): Promise<ExtractionOutcome> {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const [request] = await db
    .select()
    .from(extractionRequest)
    .where(
      and(
        eq(extractionRequest.id, job.extractionId),
        eq(extractionRequest.workspaceId, job.workspaceId),
      ),
    )
    .limit(1);
  if (!request || request.status !== "queued") return "skipped";
  await db
    .update(extractionRequest)
    .set({ status: "running", startedAt: now() })
    .where(eq(extractionRequest.id, request.id));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.deadlineMs ?? EXTRACTION_DEADLINE_MS);
  const finish = async (
    status: "succeeded" | "failed",
    values: Partial<typeof extractionRequest.$inferInsert>,
  ) => {
    await db
      .update(extractionRequest)
      .set({ status, completedAt: now(), ...values })
      .where(eq(extractionRequest.id, request.id));
  };

  try {
    // 1. Screenshots, in parallel; each upload is deleted by the file processor (FR-015).
    let recognizedText = request.recognizedText;
    let redactions = request.redactions;
    let failedScreenshots = request.failedScreenshots;
    if (recognizedText === null) {
      const uploads = await db
        .select({ id: upload.id, objectKey: upload.objectKey })
        .from(upload)
        .where(and(eq(upload.extractionRequestId, request.id), ne(upload.status, "deleted")));
      const results = await withDeadline(
        Promise.all(
          uploads.map(async (item) => {
            const response = await deps.sandbox.processFile({
              objectKey: item.objectKey,
              purpose: "screenshot",
            });
            const text = "text" in response ? response.text : null;
            await db
              .update(upload)
              .set({
                status: "deleted",
                deletedAt: now(),
                rejectReason: "error" in response ? response.error : null,
              })
              .where(eq(upload.id, item.id));
            return text;
          }),
        ),
        controller.signal,
      );
      failedScreenshots = results.filter((text) => text === null).length;
      const joined = results.filter((text): text is string => Boolean(text)).join("\n\n");
      const redacted = redactRestrictedValues(joined);
      recognizedText = redacted.text || null;
      redactions = mergeCounts(redactions, redacted.counts);
      // Stored before the model call, so a retry reuses it without the screenshots (FR-016).
      await db
        .update(extractionRequest)
        .set({ recognizedText, redactions, failedScreenshots })
        .where(eq(extractionRequest.id, request.id));
    }

    // 2. One model call on the redacted text only (research R4, R6).
    const combined = [request.inputText, recognizedText].filter(Boolean).join("\n\n").trim();
    if (!combined) {
      await finish("failed", { errorCode: "nothing_found" });
      return "nothing_found";
    }
    const answer = await withDeadline(
      deps.llm.extractListing(combined, { signal: controller.signal }),
      controller.signal,
    );
    const usage = {
      model: answer.model,
      inputTokens: answer.usage.inputTokens,
      outputTokens: answer.usage.outputTokens,
      costUsdMicros: answer.usage.costUsdMicros,
    };
    if (answer.outcome !== "ok" || !answer.result) {
      await finish("failed", { errorCode: "ai_unavailable", ...usage });
      return "ai_unavailable";
    }

    // 3. The output is checked again before anything is stored (FR-013).
    const outcome = processExtractionOutput(answer.result);
    const facts = outcome.proposedFacts;
    if (
      outcome.items.length === 0 &&
      facts.checkInTime === null &&
      facts.checkoutTime === null &&
      facts.maxGuests === null
    ) {
      await finish("failed", { errorCode: "nothing_found", ...usage });
      return "nothing_found";
    }
    await finish("succeeded", {
      errorCode: null,
      result: {
        items: outcome.items,
        proposedFacts: outcome.proposedFacts,
        language: outcome.language,
      },
      ...usage,
    });
    return "succeeded";
  } catch (error) {
    const timedOut = controller.signal.aborted || error instanceof LlmTimeoutError;
    await finish("failed", { errorCode: timedOut ? "timeout" : "ai_unavailable" });
    return timedOut ? "timeout" : "ai_unavailable";
  } finally {
    clearTimeout(timer);
  }
}

/** The pg-boss handler: one span per request (constitution VIII). */
export function createExtractionHandler(deps: ExtractionDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<ExtractionRunJob>;
      if (typeof data.extractionId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload = { extractionId: data.extractionId, workspaceId: data.workspaceId };
      await runInJobSpan(
        { queue: JOB_QUEUES.extractionRun, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await runExtraction(deps, payload);
          span.set({ "job.outcome": outcome });
          if (outcome === "timeout" || outcome === "ai_unavailable") span.recordFailure(outcome);
        },
        deps.span,
      );
    }
  };
}
