import {
  consumeDailyCount,
  derivedBasis,
  guideAiRequest,
  workspaceLimitInputs,
  type Database,
} from "@guidesk/db";
import { guideAiDailyLimit, guideAiLimitKey, guideAiLimitResetsAt } from "@guidesk/domain";
import type { LlmCallResult } from "@guidesk/integrations";

/**
 * The daily guide AI limit and usage records, for worker jobs (feature 003 FR-064, research R6).
 * A refused request makes no call (AC-SEC-012).
 */
export async function takeGuideAi(
  db: Database,
  workspaceId: string,
  now: Date = new Date(),
): Promise<{ allowed: boolean; resetsAt: Date }> {
  const inputs = await workspaceLimitInputs(db, workspaceId);
  const limit = guideAiDailyLimit(inputs ? derivedBasis(inputs) : 2, inputs?.guideAiDailyLimit);
  const result = await consumeDailyCount(db, guideAiLimitKey(workspaceId, now), limit);
  return { allowed: result.allowed, resetsAt: guideAiLimitResetsAt(now) };
}

export type GuideAiKind = "draft_listing" | "interview_answer" | "document" | "translation";

/** Records one AI call's usage; never its content (constitution VIII). */
export async function recordGuideAi(
  db: Database,
  input: {
    workspaceId: string;
    guideId: string | null;
    kind: GuideAiKind;
    result?: Pick<LlmCallResult<unknown>, "outcome" | "usage" | "model">;
    outcome?: "timeout" | "unavailable";
  },
): Promise<void> {
  await db.insert(guideAiRequest).values({
    workspaceId: input.workspaceId,
    guideId: input.guideId,
    kind: input.kind,
    model: input.result?.model ?? "none",
    inputTokens: input.result?.usage.inputTokens ?? 0,
    outputTokens: input.result?.usage.outputTokens ?? 0,
    costUsdMicros: input.result?.usage.costUsdMicros ?? 0,
    outcome: input.outcome ?? input.result?.outcome ?? "invalid",
  });
}
