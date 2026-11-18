import type { AutonomyLevel } from "./settings.js";

/**
 * The assistant's policy decision (feature 005 research R5, PRD §6.2). Mandatory escalations are
 * decided from the classification alone, before any answer is written, whatever the autonomy.
 */
export const ESCALATIONS = [
  "none",
  "emergency",
  "malfunction",
  "complaint",
  "money",
  "reservation_change",
  "legal",
  "sensitive_request",
] as const;
export type Escalation = (typeof ESCALATIONS)[number];

export const SENTIMENTS = ["positive", "neutral", "negative", "very_negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/** Kept for spec 005 callers; the levels live in `settings.ts` (feature 007). */
export type Autonomy = AutonomyLevel;

export const NEEDS_HOST_REASONS = [
  "emergency",
  "malfunction",
  "complaint",
  "money",
  "reservation_change",
  "legal",
  "not_confident",
  "draft_ready",
  "check_failed",
  "limit",
  "unavailable",
] as const;
export type NeedsHostReason = (typeof NEEDS_HOST_REASONS)[number];

export interface Classification {
  /** BCP 47 language of the guest's message, for example "en" or "pt-BR". */
  language: string;
  /** A guide section kind, or `greeting`, or `other`. */
  topic: string;
  escalation: Escalation;
  sentiment: Sentiment;
  injection: boolean;
}

export type BeforeAnswer =
  | { kind: "hold"; reason: NeedsHostReason; emergency: boolean }
  | { kind: "pointer" }
  | { kind: "greeting" }
  | { kind: "answer" };

const ESCALATION_REASON: Partial<Record<Escalation, NeedsHostReason>> = {
  emergency: "emergency",
  malfunction: "malfunction",
  complaint: "complaint",
  money: "money",
  reservation_change: "reservation_change",
  legal: "legal",
};

/** Steps 1 to 5 of research R5. `overBudget` means a daily AI budget is used up. */
export function decideBeforeAnswer(
  classification: Classification,
  overBudget: boolean,
): BeforeAnswer {
  const reason = ESCALATION_REASON[classification.escalation];
  if (reason) return { kind: "hold", reason, emergency: reason === "emergency" };
  if (
    classification.escalation !== "sensitive_request" &&
    classification.sentiment === "very_negative"
  ) {
    return { kind: "hold", reason: "complaint", emergency: false };
  }
  if (classification.escalation === "sensitive_request") return { kind: "pointer" };
  if (overBudget) return { kind: "hold", reason: "limit", emergency: false };
  if (classification.topic === "greeting") return { kind: "greeting" };
  return { kind: "answer" };
}

/** What the answer call wrote (feature 007 research R2). */
export const ANSWER_KINDS = ["grounded", "general", "clarify"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

export interface CandidateAnswer {
  answerable: boolean;
  needsHost: boolean;
  /** Spec 005 answers are all grounded. */
  kind?: AnswerKind;
}

export type AfterAnswer = { kind: "send" } | { kind: "draft"; reason: NeedsHostReason };

/**
 * Step 6 of feature 005 research R5, per level (feature 007 research R2): `draft` drafts every
 * answer; `auto` sends grounded answers that pass the checks; `full_auto` also sends general
 * answers and one clarifying question (never two in a row) that pass theirs.
 */
export function decideAfterAnswer(
  answer: CandidateAnswer,
  level: AutonomyLevel,
  checksPassed: boolean,
  previousWasClarify = false,
): AfterAnswer {
  if (!answer.answerable || answer.needsHost) return { kind: "draft", reason: "not_confident" };
  if (level === "draft") return { kind: "draft", reason: "draft_ready" };
  const kind = answer.kind ?? "grounded";
  if (kind !== "grounded" && level !== "full_auto") return { kind: "draft", reason: "draft_ready" };
  if (kind === "clarify" && previousWasClarify) return { kind: "draft", reason: "draft_ready" };
  if (!checksPassed) return { kind: "draft", reason: "check_failed" };
  return { kind: "send" };
}

/** The section that holds a sensitive value the guest asked about (FR-010). */
export function pointerSectionKind(topic: string): "wifi" | "arrival" {
  return topic === "wifi" ? "wifi" : "arrival";
}
