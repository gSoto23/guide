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

/** A workspace's top-ups that still count: unexpired, with replies left (feature 019). */
export interface OpenTopUp {
  id: string;
  granted: number;
  used: number;
  remaining: number;
  addedAt: string;
  expiresAt: string;
}

/**
 * AI replies left in the workspace's unexpired top-ups at `now` (feature 019 FR-006, FR-007).
 * Members may read the rows of their workspace; jobs read with system privileges.
 */
export async function topUpBalance(
  db: Database | Transaction,
  workspaceId: string,
  now: Date = new Date(),
): Promise<number> {
  const result = await db.execute<{ balance: number }>(sql`
    SELECT coalesce(sum(replies_granted - replies_used), 0)::int AS balance
      FROM ai_top_up
     WHERE workspace_id = ${workspaceId} AND replies_used < replies_granted
       AND expires_at > ${now}`);
  return Number(result.rows[0]?.balance ?? 0);
}

/** The open top-ups, oldest first (the order replies are taken in), at most `limit`. */
export async function openTopUps(
  db: Database | Transaction,
  workspaceId: string,
  now: Date = new Date(),
  limit = 20,
): Promise<OpenTopUp[]> {
  const result = await db.execute<{
    id: string;
    replies_granted: number;
    replies_used: number;
    created_at: Date;
    expires_at: Date;
  }>(sql`
    SELECT id, replies_granted, replies_used, created_at, expires_at
      FROM ai_top_up
     WHERE workspace_id = ${workspaceId} AND replies_used < replies_granted
       AND expires_at > ${now}
     ORDER BY created_at, id
     LIMIT ${limit}`);
  return result.rows.map((row) => ({
    id: row.id,
    granted: Number(row.replies_granted),
    used: Number(row.replies_used),
    remaining: Number(row.replies_granted) - Number(row.replies_used),
    addedAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  }));
}

/**
 * Takes one AI reply from the oldest open top-up (feature 019 FR-006, research R4). One conditional
 * update: a row another transaction holds is skipped, and `replies_used` never passes
 * `replies_granted`, so a balance never goes below zero. Returns the top-up's ID, or null when no
 * reply was left. System privileges only (the worker).
 */
export async function takeTopUpReply(
  db: Database | Transaction,
  workspaceId: string,
): Promise<string | null> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE ai_top_up SET replies_used = replies_used + 1
     WHERE id = (
       SELECT id FROM ai_top_up
        WHERE workspace_id = ${workspaceId} AND replies_used < replies_granted
          AND expires_at > now()
        ORDER BY created_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED)
       AND replies_used < replies_granted
    RETURNING id`);
  return result.rows[0]?.id ?? null;
}
