/**
 * Translation states per item and non-source language (feature 003 FR-044 to FR-046, data model
 * §7). Machine translations follow their source automatically; reviewed ones never change without
 * the host.
 */
export type TextOrigin = "source" | "machine" | "reviewed";
export type TextState = "current" | "stale" | "out_of_date" | "pending" | "failed";
export type PendingReason = "ai_limit" | "ai_unavailable" | "tokens_mismatch";

export interface TranslationStatus {
  origin: Exclude<TextOrigin, "source">;
  state: TextState;
  pendingReason?: PendingReason | null;
}

/** The source changed (FR-046): machine text waits for a new translation; reviewed text is out of date. */
export function afterSourceChange(current: TranslationStatus): TranslationStatus {
  if (
    current.origin === "reviewed" &&
    (current.state === "current" || current.state === "out_of_date")
  ) {
    return { origin: "reviewed", state: "out_of_date", pendingReason: null };
  }
  return { origin: current.origin, state: "stale", pendingReason: null };
}

/** A new translation arrived. */
export function afterTranslation(): TranslationStatus {
  return { origin: "machine", state: "current", pendingReason: null };
}

/**
 * A translation did not arrive: the daily limit and an unavailable model wait for a retry
 * (`pending`); tokens that do not match after the retry fail (research R7).
 */
export function afterTranslationFailure(
  current: TranslationStatus,
  reason: PendingReason,
): TranslationStatus {
  return {
    origin: current.origin,
    state: reason === "tokens_mismatch" ? "failed" : "pending",
    pendingReason: reason,
  };
}

/** The host edited the translation or marked it reviewed (FR-045). */
export function afterHostReview(): TranslationStatus {
  return { origin: "reviewed", state: "current", pendingReason: null };
}

/** "Keep as is" on an out-of-date reviewed translation (FR-046). */
export function afterKeep(current: TranslationStatus): TranslationStatus {
  return current.state === "out_of_date"
    ? { origin: "reviewed", state: "current", pendingReason: null }
    : current;
}

/** "Translate again": the next job replaces the text with a machine translation. */
export function afterTranslateAgain(current: TranslationStatus): TranslationStatus {
  return { origin: current.origin, state: "stale", pendingReason: null };
}

/** Whether the translation job should translate this text. */
export function needsTranslation(status: Pick<TranslationStatus, "state">): boolean {
  return status.state === "stale" || status.state === "pending";
}
