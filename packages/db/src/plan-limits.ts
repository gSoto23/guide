import { sql } from "drizzle-orm";
import {
  effectiveLimits,
  effectivePropertyLimit,
  isPlan,
  limitBasis,
  monthBounds,
  type EffectiveLimits,
  type WorkspacePlan,
} from "@guidesk/domain";
import type { Database } from "./client.js";
import type { Transaction } from "./rls.js";

/** A workspace's plan, custom limits, and the counts its limits depend on (feature 011 R2). */
export interface WorkspaceLimitInputs extends WorkspacePlan {
  status: "active" | "pending_deletion";
  /** Active properties; removed ones never count. */
  activeProperties: number;
  /** Feature 003 overrides for the derived daily guide AI and media limits. */
  guideAiDailyLimit: number | null;
  mediaStorageLimitMb: number | null;
}

const numberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/**
 * Reads the inputs in one query. Works under a member's RLS context (the workspace row and its
 * properties are visible to members) and with system privileges in jobs. Null when not visible.
 */
export async function workspaceLimitInputs(
  db: Database | Transaction,
  workspaceId: string,
): Promise<WorkspaceLimitInputs | null> {
  const result = await db.execute<{
    plan: string;
    status: string;
    property_limit: number | null;
    seat_limit: number | null;
    ai_reply_monthly_limit: number | null;
    guide_ai_daily_limit: number | null;
    media_storage_limit_mb: number | null;
    active: number;
  }>(sql`
    SELECT w.plan, w.status, w.property_limit, w.seat_limit, w.ai_reply_monthly_limit,
           w.guide_ai_daily_limit, w.media_storage_limit_mb,
           (SELECT count(*)::int FROM property p
             WHERE p.workspace_id = w.id AND p.status = 'active') AS active
      FROM workspace w
     WHERE w.id = ${workspaceId}`);
  const row = result.rows[0];
  if (!row) return null;
  return {
    plan: isPlan(row.plan) ? row.plan : "free",
    status: row.status === "pending_deletion" ? "pending_deletion" : "active",
    propertyLimit: numberOrNull(row.property_limit),
    seatLimit: numberOrNull(row.seat_limit),
    aiReplyMonthlyLimit: numberOrNull(row.ai_reply_monthly_limit),
    guideAiDailyLimit: numberOrNull(row.guide_ai_daily_limit),
    mediaStorageLimitMb: numberOrNull(row.media_storage_limit_mb),
    activeProperties: Number(row.active),
  };
}

/** The effective limits for the inputs (FR-002, FR-003). */
export function limitsFor(inputs: WorkspaceLimitInputs): EffectiveLimits {
  return effectiveLimits(inputs, inputs.activeProperties);
}

/** The property count that sizes the derived daily limits (FR-005). */
export function derivedBasis(inputs: WorkspaceLimitInputs): number {
  return limitBasis(effectivePropertyLimit(inputs), inputs.activeProperties);
}

/**
 * AI replies this UTC month (feature 011 R3): the daily counts of every model reply or draft
 * (guide chat, copilot, tests) since the 1st. Members may read the counts of their workspace.
 */
export async function monthlyAiReplies(
  db: Database | Transaction,
  workspaceId: string,
  now: Date = new Date(),
): Promise<number> {
  const start = monthBounds(now).start.toISOString().slice(0, 10);
  const result = await db.execute<{ replies: number }>(sql`
    SELECT coalesce(sum(replies), 0)::int AS replies
      FROM chat_usage_daily
     WHERE workspace_id = ${workspaceId} AND day >= ${start}::date`);
  return Number(result.rows[0]?.replies ?? 0);
}
