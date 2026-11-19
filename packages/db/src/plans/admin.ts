import { sql } from "drizzle-orm";
import {
  assertSafeMetadata,
  effectiveLimits,
  isPlan,
  monthBounds,
  type EffectiveLimits,
  type Plan,
} from "@guidesk/domain";
import type { Database } from "../client.js";
import { monthlyAiReplies, workspaceLimitInputs } from "../plan-limits.js";
import { securityEvent } from "../security-event.js";

/**
 * The founder's plan tool (feature 011 US3, research R8). Runs with the migration user's privileges,
 * never through the API. Each change is one transaction: the workspace row and a security event
 * `workspace.plan_changed` (actor none, shown as Guidesk) with short values only; the note stays on
 * the workspace.
 */
export class PlanAdminError extends Error {}

/** A custom limit: a positive whole number, `"plan"` to clear it, or undefined to keep it. */
export type CustomLimitChange = number | "plan" | undefined;

export interface SetPlanInput {
  workspaceId: string;
  plan: string;
  properties?: CustomLimitChange;
  seats?: CustomLimitChange;
  aiReplies?: CustomLimitChange;
  /** Feature 013: a custom platform fee in basis points (0 to 3,000), "plan", or keep. */
  feeBps?: number | "plan";
  note: string;
}

export interface SetPlanResult {
  from: Plan;
  to: Plan;
  custom: {
    properties: number | null;
    seats: number | null;
    aiReplies: number | null;
    feeBps: number | null;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIMIT = 1_000_000;

/** Parses `--fee-percent`: 0 to 30 with up to two decimals, or "plan" (feature 013 FR-021). */
export function parseFeePercent(value: string | undefined): number | "plan" | undefined {
  if (value === undefined) return undefined;
  if (value === "plan") return "plan";
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(value) || Number(value) > 30) {
    throw new PlanAdminError('--fee-percent must be from 0 to 30 (up to two decimals), or "plan".');
  }
  return Math.round(Number(value) * 100);
}

/** Parses a CLI value for a custom limit; throws on anything but a positive whole number or "plan". */
export function parseCustomLimit(name: string, value: string | undefined): CustomLimitChange {
  if (value === undefined) return undefined;
  if (value === "plan") return "plan";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_LIMIT) {
    throw new PlanAdminError(`--${name} must be a whole number from 1 to ${MAX_LIMIT}, or "plan".`);
  }
  return Number(value);
}

function next(current: number | null, change: CustomLimitChange): number | null {
  if (change === undefined) return current;
  if (change === "plan") return null;
  if (!Number.isInteger(change) || change < 1 || change > MAX_LIMIT) {
    throw new PlanAdminError(`Custom limits must be whole numbers from 1 to ${MAX_LIMIT}.`);
  }
  return change;
}

export async function setPlan(db: Database, input: SetPlanInput): Promise<SetPlanResult> {
  if (!UUID.test(input.workspaceId)) throw new PlanAdminError("--workspace must be a UUID.");
  if (!isPlan(input.plan)) throw new PlanAdminError("--plan must be free, pro, or business.");
  const plan = input.plan;
  const note = input.note.trim();
  if (note.length < 1 || note.length > 200) {
    throw new PlanAdminError("--note is required (1 to 200 characters).");
  }
  return db.transaction(async (tx) => {
    const locked = await tx.execute<{
      plan: string;
      property_limit: number | null;
      seat_limit: number | null;
      ai_reply_monthly_limit: number | null;
      platform_fee_bps: number | null;
    }>(sql`
      SELECT plan, property_limit, seat_limit, ai_reply_monthly_limit, platform_fee_bps
        FROM workspace WHERE id = ${input.workspaceId} FOR UPDATE`);
    const row = locked.rows[0];
    if (!row) throw new PlanAdminError("No workspace with that ID.");
    const custom = {
      properties: next(row.property_limit, input.properties),
      seats: next(row.seat_limit, input.seats),
      aiReplies: next(row.ai_reply_monthly_limit, input.aiReplies),
      feeBps:
        input.feeBps === undefined
          ? row.platform_fee_bps
          : input.feeBps === "plan"
            ? null
            : input.feeBps,
    };
    if (custom.feeBps !== null && (custom.feeBps < 0 || custom.feeBps > 3000)) {
      throw new PlanAdminError("The platform fee must be from 0 to 30%.");
    }
    await tx.execute(sql`
      UPDATE workspace
         SET plan = ${plan}, plan_changed_at = now(), plan_note = ${note},
             property_limit = ${custom.properties}, seat_limit = ${custom.seats},
             ai_reply_monthly_limit = ${custom.aiReplies}, platform_fee_bps = ${custom.feeBps},
             updated_at = now()
       WHERE id = ${input.workspaceId}`);
    const from = isPlan(row.plan) ? row.plan : "free";
    const metadata = {
      from,
      to: plan,
      properties: custom.properties ?? "plan",
      seats: custom.seats ?? "plan",
      aiReplies: custom.aiReplies ?? "plan",
      feeBps: custom.feeBps ?? "plan",
    };
    assertSafeMetadata(metadata, "workspace.plan_changed");
    await tx.insert(securityEvent).values({
      type: "workspace.plan_changed",
      outcome: "success",
      actorUserId: null,
      workspaceId: input.workspaceId,
      targetType: "workspace",
      targetId: input.workspaceId,
      metadata,
    });
    return { from, to: plan, custom };
  });
}

export interface PlanReport {
  workspaceId: string;
  plan: Plan;
  changedAt: string | null;
  note: string | null;
  limits: EffectiveLimits;
  usage: { properties: number; members: number; pending: number; aiReplies: number };
  month: { start: string; resetsAt: string };
}

export async function showPlan(
  db: Database,
  workspaceId: string,
  now: Date = new Date(),
): Promise<PlanReport> {
  if (!UUID.test(workspaceId)) throw new PlanAdminError("--workspace must be a UUID.");
  const inputs = await workspaceLimitInputs(db, workspaceId);
  if (!inputs) throw new PlanAdminError("No workspace with that ID.");
  const details = await db.execute<{
    plan_changed_at: Date | null;
    plan_note: string | null;
    members: number;
    pending: number;
  }>(sql`
    SELECT w.plan_changed_at, w.plan_note,
           (SELECT count(*)::int FROM membership m WHERE m.workspace_id = w.id) AS members,
           (SELECT count(*)::int FROM invitation i
             WHERE i.workspace_id = w.id AND i.status = 'pending' AND i.expires_at > ${now}) AS pending
      FROM workspace w WHERE w.id = ${workspaceId}`);
  const row = details.rows[0]!;
  const { start, resetsAt } = monthBounds(now);
  return {
    workspaceId,
    plan: inputs.plan,
    changedAt: row.plan_changed_at ? new Date(row.plan_changed_at).toISOString() : null,
    note: row.plan_note,
    limits: effectiveLimits(inputs, inputs.activeProperties),
    usage: {
      properties: inputs.activeProperties,
      members: Number(row.members),
      pending: Number(row.pending),
      aiReplies: await monthlyAiReplies(db, workspaceId, now),
    },
    month: { start: start.toISOString(), resetsAt: resetsAt.toISOString() },
  };
}

const limitText = (limit: number | null) => (limit === null ? "unlimited" : String(limit));

/** A short table for the terminal: counts and limits only. */
export function formatPlanReport(report: PlanReport): string {
  const { limits, usage } = report;
  return [
    `Workspace ${report.workspaceId}`,
    `Plan: ${report.plan}${report.changedAt ? ` (changed ${report.changedAt})` : ""}`,
    `Note: ${report.note ?? "—"}`,
    `Properties: ${usage.properties} of ${limitText(limits.properties.limit)} (${limits.properties.source})`,
    `Seats: ${usage.members + usage.pending} of ${limitText(limits.seats.limit)} (${limits.seats.source}; ${usage.members} members, ${usage.pending} pending)`,
    `AI replies this month: ${usage.aiReplies} of ${limits.aiReplies.limit} (${limits.aiReplies.source}${limits.aiReplies.perProperty ? `, ${limits.aiReplies.perProperty} per active property` : ""}); renews ${report.month.resetsAt}`,
  ].join("\n");
}
