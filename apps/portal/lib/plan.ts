import type { Plan } from "@guidesk/contracts";

/**
 * Feature 011 helpers for the client. Kept out of `@guidesk/contracts/values` so routes stay within
 * the 150 KB budget (research R9).
 */
export const PLAN_NAMES = ["free", "pro", "business"] as const satisfies readonly Plan[];

/** When this month's AI replies renew: 00:00 UTC on the 1st of next month. */
export function nextRenewal(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** A moment in the member's own time zone, for example "30 nov 2026, 18:00". */
export function formatMoment(locale: string, moment: Date | string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    typeof moment === "string" ? new Date(moment) : moment,
  );
}

/** Properties that still fit: unlimited plans have no cap (feature 011). */
export function roomFor(limits: { limit: number | null; used: number }): number {
  return limits.limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limits.limit - limits.used);
}

/** Whole share of a limit for a meter, capped at 100. */
export function share(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

/**
 * Where the month's AI replies stand (feature 019): below 80%; at 80% or more; used up but a
 * top-up keeps the AI answering; or used up with no top-up, so the AI pauses until the 1st.
 */
export type AiState = "ok" | "warning" | "topUp" | "paused";

export function aiState(ai: { used: number; limit: number }, topUpBalance: number): AiState {
  if (ai.used >= ai.limit) return topUpBalance > 0 ? "topUp" : "paused";
  return ai.used * 100 >= ai.limit * 80 ? "warning" : "ok";
}

/** A date without the time, for example "20 nov 2027". */
export function formatDay(locale: string, moment: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(moment));
}

/** A mail link to Guidesk with a subject naming the workspace (feature 019 FR-012). */
export function askMoreHref(email: string, subject: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
