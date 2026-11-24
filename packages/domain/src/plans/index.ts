/**
 * Plans and their limits (feature 011 FR-001 to FR-005, research R1 and R2). The founder changes
 * the numbers here; the AI reply allowances are the founder's decision of 2026-11-24 (feature 019
 * FR-001). Unlimited is `null`.
 */
export const PLANS = ["free", "pro", "business"] as const;
export type Plan = (typeof PLANS)[number];

export function isPlan(value: unknown): value is Plan {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}

/** AI replies per active property per month on Pro and Business, pooled across the workspace. */
export const POOLED_AI_REPLIES_PER_PROPERTY = 300;

/** Free's monthly AI replies while the pilot lasts (feature 019); revisited after the pilot. */
export const FREE_AI_REPLIES_PER_MONTH = 500;

export interface PlanLimits {
  /** Active properties; null is unlimited. */
  properties: number | null;
  /** Members plus pending invitations; null is unlimited. */
  seats: number | null;
  /**
   * A fixed number of AI replies per month, or a pooled allowance per active property with a
   * minimum for the whole workspace.
   */
  aiReplies:
    { kind: "fixed"; perMonth: number } | { kind: "pooled"; perProperty: number; minimum: number };
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    properties: 2,
    seats: 1,
    aiReplies: { kind: "fixed", perMonth: FREE_AI_REPLIES_PER_MONTH },
  },
  pro: {
    properties: null,
    seats: 3,
    aiReplies: { kind: "pooled", perProperty: POOLED_AI_REPLIES_PER_PROPERTY, minimum: 500 },
  },
  business: {
    properties: null,
    seats: null,
    aiReplies: { kind: "pooled", perProperty: POOLED_AI_REPLIES_PER_PROPERTY, minimum: 1000 },
  },
};

/** What the workspace row holds: its plan and the custom limits Guidesk set (null = the plan's). */
export interface WorkspacePlan {
  plan: Plan;
  propertyLimit: number | null;
  seatLimit: number | null;
  aiReplyMonthlyLimit: number | null;
}

export type LimitSource = "plan" | "custom";

export interface EffectiveLimits {
  properties: { limit: number | null; source: LimitSource };
  seats: { limit: number | null; source: LimitSource };
  /** `perProperty` and `minimum` describe a pooled plan allowance; null otherwise. */
  aiReplies: {
    limit: number;
    source: LimitSource;
    perProperty: number | null;
    minimum: number | null;
  };
}

/** The plan's limits with the custom ones applied (FR-003), for `activeProperties` right now. */
export function effectiveLimits(
  workspace: WorkspacePlan,
  activeProperties: number,
): EffectiveLimits {
  const plan = PLAN_LIMITS[workspace.plan];
  const ai = plan.aiReplies;
  const planAi =
    ai.kind === "fixed" ? ai.perMonth : Math.max(ai.minimum, ai.perProperty * activeProperties);
  return {
    properties:
      workspace.propertyLimit === null
        ? { limit: plan.properties, source: "plan" }
        : { limit: workspace.propertyLimit, source: "custom" },
    seats:
      workspace.seatLimit === null
        ? { limit: plan.seats, source: "plan" }
        : { limit: workspace.seatLimit, source: "custom" },
    aiReplies:
      workspace.aiReplyMonthlyLimit === null
        ? {
            limit: planAi,
            source: "plan",
            perProperty: ai.kind === "pooled" ? ai.perProperty : null,
            minimum: ai.kind === "pooled" ? ai.minimum : null,
          }
        : {
            limit: workspace.aiReplyMonthlyLimit,
            source: "custom",
            perProperty: null,
            minimum: null,
          },
  };
}

/** The effective property limit alone; null is unlimited. */
export function effectivePropertyLimit(workspace: Pick<WorkspacePlan, "plan" | "propertyLimit">) {
  return workspace.propertyLimit ?? PLAN_LIMITS[workspace.plan].properties;
}

/** The effective seat limit alone; null is unlimited. */
export function effectiveSeatLimit(workspace: Pick<WorkspacePlan, "plan" | "seatLimit">) {
  return workspace.seatLimit ?? PLAN_LIMITS[workspace.plan].seats;
}

/**
 * The property count that sizes the derived daily limits (extractions, guide AI requests, media
 * storage; FR-005): the property limit, or for unlimited plans the active properties plus 2 (room
 * for the next ones). Never below Free's 2.
 */
export function limitBasis(propertyLimit: number | null, activeProperties: number): number {
  const free = PLAN_LIMITS.free.properties ?? 2;
  return Math.max(free, propertyLimit ?? activeProperties + 2);
}

/** How many more fit under a limit; Infinity when unlimited. */
export function roomLeft(limit: number | null, used: number): number {
  return limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - used);
}

/** The UTC calendar month around `now`: its first moment and the next month's (the renewal). */
export function monthBounds(now: Date): { start: Date; resetsAt: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/** Warning thresholds for the month's AI replies (FR-009, FR-015). */
export const AI_USAGE_THRESHOLDS = [80, 100] as const;
export type AiUsageThreshold = (typeof AI_USAGE_THRESHOLDS)[number];

/** The highest threshold reached, or null below 80%. */
export function aiUsageThreshold(used: number, limit: number): AiUsageThreshold | null {
  if (limit <= 0 || used >= limit) return 100;
  return used * 100 >= limit * 80 ? 80 : null;
}
