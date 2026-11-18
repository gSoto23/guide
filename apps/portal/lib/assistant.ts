import type { AssistantLevel, AssistantTopic } from "@guidesk/contracts";

/**
 * Assistant settings constants for the portal (feature 007). Kept here instead of importing the
 * values from `@guidesk/contracts`, which would bring zod into the client bundle (plan Performance
 * Budget); the type checks below fail the build when the lists drift from the contracts.
 */
export const TOPICS = [
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
] as const satisfies readonly AssistantTopic[];

export const LEVELS = ["draft", "auto", "full_auto"] as const satisfies readonly AssistantLevel[];

/** The mandatory escalation rows shown locked (FR-002). */
export const LOCKED = [
  "emergency",
  "malfunction",
  "complaint",
  "money",
  "reservation_change",
  "legal",
  "codes",
  "not_confident",
] as const;

export const INSTRUCTIONS_MAX = 1000;
export const TEST_QUESTION_MAX = 2000;

type Complete<All, Listed> = [Exclude<All, Listed>] extends [never] ? true : never;
const topicsComplete: Complete<AssistantTopic, (typeof TOPICS)[number]> = true;
const levelsComplete: Complete<AssistantLevel, (typeof LEVELS)[number]> = true;
void topicsComplete;
void levelsComplete;
