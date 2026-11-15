/** Onboarding answers and the derived path (spec 001 FR-005, FR-006, data model §2). */
export const PROPERTIES_BUCKETS = ["1_2", "3_10", "10_plus"] as const;
export type PropertiesBucket = (typeof PROPERTIES_BUCKETS)[number];

/** PMS choices, from the integrations research, plus "none" and "other". */
export const PMS_OPTIONS = [
  "hostaway",
  "guesty",
  "hospitable",
  "smoobu",
  "ownerrez",
  "hostfully",
  "beds24",
  "hostex",
  "lodgify",
  "uplisting",
  "stays_net",
  "other",
  "none",
] as const;
export type PmsOption = (typeof PMS_OPTIONS)[number];

export type OnboardingPath = "individual" | "manager";

export interface OnboardingAnswers {
  propertiesBucket: PropertiesBucket | null;
  pms: PmsOption | null;
  pmsOther: string | null;
  country: string | null;
}

/**
 * Manager path when the host manages 10+ properties, or 3–10 with a PMS; otherwise the
 * individual-host path (data model §2).
 */
export function derivePath(
  answers: Pick<OnboardingAnswers, "propertiesBucket" | "pms">,
): OnboardingPath {
  if (answers.propertiesBucket === "10_plus") {
    return "manager";
  }
  const usesPms = answers.pms !== null && answers.pms !== "none";
  return answers.propertiesBucket === "3_10" && usesPms ? "manager" : "individual";
}

const COUNTRY_PATTERN = /^[A-Z]{2}$/;

/** Returns validation errors; an empty list means the answers are valid. Every answer is optional. */
export function validateOnboarding(answers: OnboardingAnswers): string[] {
  const errors: string[] = [];
  if (answers.pms === "other" && !answers.pmsOther?.trim()) {
    errors.push("pmsOther is required when pms is other");
  }
  if (answers.pms !== "other" && answers.pmsOther !== null) {
    errors.push("pmsOther is only allowed when pms is other");
  }
  if (answers.pmsOther !== null && answers.pmsOther.length > 80) {
    errors.push("pmsOther must be at most 80 characters");
  }
  if (answers.country !== null && !COUNTRY_PATTERN.test(answers.country)) {
    errors.push("country must be an ISO 3166-1 alpha-2 code");
  }
  return errors;
}
