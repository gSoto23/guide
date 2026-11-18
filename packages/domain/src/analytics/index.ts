import { todayIn } from "../properties/stays.js";

/**
 * Basic analytics (feature 010 research R2, R3, R7): periods by the property's local day, changes
 * against the previous period, rates, and the outcome of each guest question from its trace.
 */
export const ANALYTICS_PERIODS = [7, 30, 90] as const;
export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number];

export const QUESTION_OUTCOMES = ["automatic", "with_host", "escalated"] as const;
export type QuestionOutcome = (typeof QUESTION_OUTCOMES)[number];

/** Topics a question can have (the assistant's topics without greetings, spec 007). */
export const ANALYTICS_TOPICS = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
  "other",
] as const;
export type AnalyticsTopic = (typeof ANALYTICS_TOPICS)[number];

/** Escalation reasons shown to hosts; `draft_ready` and `taken_over` are bookkeeping, not reasons. */
export const ANALYTICS_REASONS = [
  "emergency",
  "malfunction",
  "complaint",
  "money",
  "reservation_change",
  "legal",
  "not_confident",
  "check_failed",
  "limit",
  "unavailable",
] as const;
export type AnalyticsReason = (typeof ANALYTICS_REASONS)[number];

/** Unanswered questions are the ones the assistant didn't know (research R6). */
export const UNANSWERED_REASON = "not_confident" satisfies AnalyticsReason;

const DAY_MS = 86_400_000;

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  return new Date(date.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export interface PeriodBounds {
  /** Today in the zone (the last day of the current period). */
  today: string;
  /** First day of the current period. */
  from: string;
  /** First day of the previous period of the same length. */
  previousFrom: string;
  /** Last day of the previous period. */
  previousTo: string;
}

/** The current and previous periods ending today in `timeZone` (UTC when null). */
export function periodBounds(
  days: AnalyticsPeriod,
  timeZone: string | null,
  now: Date = new Date(),
): PeriodBounds {
  const today = todayIn(timeZone ?? "UTC", now);
  const from = shiftDay(today, -(days - 1));
  return {
    today,
    from,
    previousFrom: shiftDay(from, -days),
    previousTo: shiftDay(from, -1),
  };
}

/**
 * Whether the previous period can be compared: it must start on or after the day the property (or
 * workspace) was created in that zone (research R7).
 */
export function isComparable(
  days: AnalyticsPeriod,
  timeZone: string | null,
  createdAt: Date,
  now: Date = new Date(),
): boolean {
  const { previousFrom } = periodBounds(days, timeZone, now);
  return todayIn(timeZone ?? "UTC", createdAt) <= previousFrom;
}

export interface Change {
  absolute: number;
  /** Relative change as a fraction (0.5 = +50%); null when the previous value is 0. */
  relative: number | null;
}

export function changeOf(current: number, previous: number): Change {
  return {
    absolute: current - previous,
    relative: previous === 0 ? null : (current - previous) / previous,
  };
}

/** A share, or null when there is nothing to divide by (FR-015). */
export function rateOf(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** The outcome of a guest question from its trace decision, or null when it isn't a question. */
export function questionOutcome(decision: string): QuestionOutcome | null {
  switch (decision) {
    case "answered":
    case "pointer":
      return "automatic";
    case "drafted":
    case "paused":
      return "with_host";
    case "held":
      return "escalated";
    default:
      return null;
  }
}

/** The reason to count for a trace, or null for bookkeeping reasons and answers. */
export function countedReason(reason: string | null): AnalyticsReason | null {
  return reason && (ANALYTICS_REASONS as readonly string[]).includes(reason)
    ? (reason as AnalyticsReason)
    : null;
}

/** The topic to count for a classification; greetings aren't questions and unknown topics are `other`. */
export function countedTopic(topic: unknown): AnalyticsTopic | null {
  if (topic === "greeting") return null;
  return typeof topic === "string" && (ANALYTICS_TOPICS as readonly string[]).includes(topic)
    ? (topic as AnalyticsTopic)
    : "other";
}
