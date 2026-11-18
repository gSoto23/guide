import { z } from "zod";

/**
 * Basic analytics (feature 010 contracts/http-api.md). Counts only; rates are computed by the client
 * from the counts so totals and rates always agree. Guest text appears only in the unanswered list.
 */
export const analyticsQuerySchema = z
  .object({
    period: z.enum(["7", "30", "90"]),
    propertyId: z.uuid().optional(),
  })
  .strict();
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const unansweredQuerySchema = z
  .object({
    period: z.enum(["7", "30", "90"]),
    propertyId: z.uuid().optional(),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type UnansweredQuery = z.infer<typeof unansweredQuerySchema>;

export type AnalyticsTopicKey =
  | "arrival"
  | "wifi"
  | "house_rules"
  | "appliances"
  | "amenities"
  | "parking"
  | "local_recommendations"
  | "emergency"
  | "checkout"
  | "other";

export type AnalyticsReasonKey =
  | "emergency"
  | "malfunction"
  | "complaint"
  | "money"
  | "reservation_change"
  | "legal"
  | "not_confident"
  | "check_failed"
  | "limit"
  | "unavailable";

export type AnalyticsRequestStatus =
  "waiting" | "confirmed" | "declined" | "cancelled" | "host_cancelled" | "expired";

/** A count in the current period and the previous one of the same length. */
export interface PeriodCount {
  current: number;
  previous: number;
}

export interface AnalyticsPropertyRow {
  propertyId: string;
  name: string;
  removed: boolean;
  views: number;
  questions: number;
  automatic: number;
  escalated: number;
  requests: number;
  clicks: number;
}

export interface AnalyticsSummary {
  period: {
    days: 7 | 30 | 90;
    /** Time zones the days were counted in; `utcFallback` when a property has none. */
    timeZones: string[];
    utcFallback: boolean;
  };
  scope:
    | { kind: "property"; propertyId: string; propertyName: string; removed: boolean }
    | { kind: "workspace" };
  /** False when the previous period starts before the property or workspace existed. */
  comparable: boolean;
  views: { property: PeriodCount; stay: PeriodCount };
  staysOpened: PeriodCount;
  questions: {
    total: PeriodCount;
    automatic: PeriodCount;
    withHost: PeriodCount;
    escalated: PeriodCount;
  };
  topics: { topic: AnalyticsTopicKey; count: number }[];
  escalations: { reason: AnalyticsReasonKey; count: number }[];
  unanswered: number;
  explore: { opens: PeriodCount; clicks: { partner: string; count: number }[] };
  requests: {
    made: PeriodCount;
    byStatus: { status: AnalyticsRequestStatus; count: number }[];
    staysWithRequest: number;
  };
  /** Workspace view only: one row per property. */
  properties: AnalyticsPropertyRow[] | null;
}

export interface UnansweredQuestion {
  traceId: string;
  conversationId: string;
  propertyId: string;
  propertyName: string;
  at: string;
  /** The guest's message as stored (plain text), or null when it was removed. */
  text: string | null;
}

export interface UnansweredPage {
  items: UnansweredQuestion[];
  next: string | null;
}
