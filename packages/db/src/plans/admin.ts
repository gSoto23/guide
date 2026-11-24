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
import {
  monthlyAiReplies,
  openTopUps,
  topUpBalance,
  workspaceLimitInputs,
  type OpenTopUp,
} from "../plan-limits.js";
import { aiTopUp, TOP_UP_MAX_REPLIES } from "../schema/plans.js";
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
  /** Feature 019: the open top-ups, oldest first, and their total. */
  topUps: { balance: number; items: OpenTopUp[] };
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
    topUps: {
      balance: await topUpBalance(db, workspaceId, now),
      items: await openTopUps(db, workspaceId, now),
    },
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
    `AI replies this month: ${usage.aiReplies} of ${limits.aiReplies.limit} (${limits.aiReplies.source}${limits.aiReplies.perProperty ? `, ${limits.aiReplies.perProperty} per active property` : ""}${limits.aiReplies.minimum ? `, at least ${limits.aiReplies.minimum}` : ""}); renews ${report.month.resetsAt}`,
    `Top-ups: ${report.topUps.balance} replies left${report.topUps.items
      .map(
        (item) => `\n  ${item.id}: ${item.remaining} of ${item.granted}, expires ${item.expiresAt}`,
      )
      .join("")}`,
  ].join("\n");
}

/** Top-ups above this many replies need `--yes` (feature 019 FR-010). */
export const TOP_UP_CONFIRM_ABOVE = 5000;

/** Parses `--replies` for a top-up: a whole number from 1 to 100,000. */
export function parseTopUpReplies(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new PlanAdminError(`--replies must be a whole number from 1 to ${TOP_UP_MAX_REPLIES}.`);
  }
  const replies = Number(value);
  if (replies < 1 || replies > TOP_UP_MAX_REPLIES) {
    throw new PlanAdminError(`--replies must be a whole number from 1 to ${TOP_UP_MAX_REPLIES}.`);
  }
  return replies;
}

function cleanNote(value: string): string {
  const note = value.trim();
  if (note.length < 1 || note.length > 200) {
    throw new PlanAdminError("--note is required (1 to 200 characters).");
  }
  return note;
}

export interface AddTopUpInput {
  workspaceId: string;
  replies: number;
  note: string;
  /** Required above 5,000 replies. */
  confirmed?: boolean;
}

export interface TopUpRow {
  id: string;
  granted: number;
  used: number;
  remaining: number;
  addedAt: string;
  expiresAt: string;
  expired: boolean;
  note: string;
  correctedAt: string | null;
  correctionNote: string | null;
}

/**
 * Adds an AI reply top-up (feature 019 FR-005): one transaction with the row and a security event
 * `workspace.ai_top_up_added` (actor none, shown as Guidesk) holding the count and expiry date only;
 * the note stays on the row.
 */
export async function addTopUp(db: Database, input: AddTopUpInput): Promise<TopUpRow> {
  if (!UUID.test(input.workspaceId)) throw new PlanAdminError("--workspace must be a UUID.");
  if (!Number.isInteger(input.replies) || input.replies < 1 || input.replies > TOP_UP_MAX_REPLIES) {
    throw new PlanAdminError(`--replies must be a whole number from 1 to ${TOP_UP_MAX_REPLIES}.`);
  }
  if (input.replies > TOP_UP_CONFIRM_ABOVE && !input.confirmed) {
    throw new PlanAdminError(
      `A top-up above ${TOP_UP_CONFIRM_ABOVE} replies needs --yes to confirm (${input.replies} asked).`,
    );
  }
  const note = cleanNote(input.note);
  return db.transaction(async (tx) => {
    const found = await tx.execute(
      sql`SELECT 1 FROM workspace WHERE id = ${input.workspaceId} FOR UPDATE`,
    );
    if (found.rows.length === 0) throw new PlanAdminError("No workspace with that ID.");
    const [row] = await tx
      .insert(aiTopUp)
      .values({ workspaceId: input.workspaceId, repliesGranted: input.replies, note })
      .returning();
    const metadata = {
      replies: input.replies,
      expiresOn: row!.expiresAt.toISOString().slice(0, 10),
    };
    assertSafeMetadata(metadata, "workspace.ai_top_up_added");
    await tx.insert(securityEvent).values({
      type: "workspace.ai_top_up_added",
      outcome: "success",
      actorUserId: null,
      workspaceId: input.workspaceId,
      targetType: "workspace",
      targetId: input.workspaceId,
      metadata,
    });
    return toTopUpRow(row!, new Date());
  });
}

function toTopUpRow(row: typeof aiTopUp.$inferSelect, now: Date): TopUpRow {
  return {
    id: row.id,
    granted: row.repliesGranted,
    used: row.repliesUsed,
    remaining: row.repliesGranted - row.repliesUsed,
    addedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() <= now.getTime(),
    note: row.note,
    correctedAt: row.correctedAt ? row.correctedAt.toISOString() : null,
    correctionNote: row.correctionNote,
  };
}

/** Every top-up of the workspace, newest first, with notes (the founder's history). */
export async function listTopUps(
  db: Database,
  workspaceId: string,
  now: Date = new Date(),
): Promise<TopUpRow[]> {
  if (!UUID.test(workspaceId)) throw new PlanAdminError("--workspace must be a UUID.");
  const rows = await db
    .select()
    .from(aiTopUp)
    .where(sql`${aiTopUp.workspaceId} = ${workspaceId}`)
    .orderBy(sql`${aiTopUp.createdAt} DESC`, sql`${aiTopUp.id} DESC`);
  return rows.map((row) => toTopUpRow(row, now));
}

export interface CorrectTopUpInput {
  topUpId: string;
  /** The replies left after the correction; lower than now. */
  remaining: number;
  note: string;
}

/**
 * Lowers a top-up's unused replies (feature 019 FR-010), for example after a typo. Never raises it
 * (add a new top-up instead). Records `workspace.ai_top_up_corrected` with the counts only.
 */
export async function correctTopUp(db: Database, input: CorrectTopUpInput): Promise<TopUpRow> {
  if (!UUID.test(input.topUpId)) throw new PlanAdminError("--top-up must be a UUID.");
  if (!Number.isInteger(input.remaining) || input.remaining < 0) {
    throw new PlanAdminError("--remaining must be a whole number, 0 or more.");
  }
  const note = cleanNote(input.note);
  return db.transaction(async (tx) => {
    const locked = await tx
      .select()
      .from(aiTopUp)
      .where(sql`${aiTopUp.id} = ${input.topUpId}`)
      .for("update");
    const row = locked[0];
    if (!row) throw new PlanAdminError("No top-up with that ID.");
    const current = row.repliesGranted - row.repliesUsed;
    if (input.remaining >= current) {
      throw new PlanAdminError(
        `A correction only lowers the replies left (${current} now); add a new top-up to raise it.`,
      );
    }
    const [updated] = await tx
      .update(aiTopUp)
      .set({
        repliesGranted: row.repliesUsed + input.remaining,
        correctedAt: sql`now()`,
        correctionNote: note,
      })
      .where(sql`${aiTopUp.id} = ${input.topUpId}`)
      .returning();
    const metadata = { from: current, to: input.remaining };
    assertSafeMetadata(metadata, "workspace.ai_top_up_corrected");
    await tx.insert(securityEvent).values({
      type: "workspace.ai_top_up_corrected",
      outcome: "success",
      actorUserId: null,
      workspaceId: row.workspaceId,
      targetType: "workspace",
      targetId: row.workspaceId,
      metadata,
    });
    return toTopUpRow(updated!, new Date());
  });
}

/** A short table of top-ups for the terminal, notes included (the founder's own text). */
export function formatTopUps(rows: TopUpRow[]): string {
  if (rows.length === 0) return "No top-ups.";
  return rows
    .map(
      (row) =>
        `${row.id}: ${row.remaining} of ${row.granted} left; added ${row.addedAt}; ${row.expired ? "expired" : "expires"} ${row.expiresAt}; note: ${row.note}${row.correctedAt ? `; corrected ${row.correctedAt}: ${row.correctionNote}` : ""}`,
    )
    .join("\n");
}
