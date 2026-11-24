import { z } from "zod";

/**
 * Feature 011 (contracts/http-api.md): the workspace's plan, each limit with its usage and source,
 * and how to ask Guidesk for a change. Read-only: no route writes plans or custom limits.
 */
export type Plan = "free" | "pro" | "business";
export type PlanLimitSource = "plan" | "custom";

/** `GET plan` takes no query parameters. */
export const planQuerySchema = z.object({}).strict();

export interface PlanSummary {
  workspaceId: string;
  plan: Plan;
  /** When the founder last changed the plan; null when it never changed. */
  changedAt: string | null;
  limits: {
    /** `limit` is null when unlimited. */
    properties: { limit: number | null; used: number; source: PlanLimitSource };
    seats: {
      limit: number | null;
      used: number;
      members: number;
      pending: number;
      source: PlanLimitSource;
    };
    aiReplies: {
      limit: number;
      used: number;
      source: PlanLimitSource;
      /** 300 on Pro and Business when the limit comes from the plan, else null. */
      perProperty: number | null;
      /** Feature 019: 500 on Pro and 1,000 on Business when the limit comes from the plan, else null. */
      minimum: number | null;
      monthStart: string;
      resetsAt: string;
    };
  };
  /**
   * Feature 019: AI reply top-ups used after the month's allowance. `items` are the unexpired ones
   * with replies left, oldest first (at most 20); `balance` is their sum. Notes are never returned.
   */
  topUps: {
    balance: number;
    items: PlanTopUp[];
  };
  /** Where to ask for a change; null when Guidesk configured none. */
  contactEmail: string | null;
}

export interface PlanTopUp {
  id: string;
  granted: number;
  remaining: number;
  addedAt: string;
  expiresAt: string;
}
