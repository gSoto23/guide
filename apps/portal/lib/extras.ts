import type {
  ExtraCurrency,
  ExtraSuggestion,
  ServiceRequestAnswerReason,
} from "@guidesk/contracts";

/**
 * Extras constants for the portal (feature 008). Kept here instead of `@guidesk/contracts/values`,
 * which every route that imports a value downloads (plan Performance Budget); the type checks below
 * fail the build when the lists drift from the contracts.
 */
export const CURRENCIES = [
  "USD",
  "CRC",
  "MXN",
  "EUR",
  "COP",
  "GTQ",
] as const satisfies readonly ExtraCurrency[];

export const SUGGESTIONS = [
  "airport_pickup",
  "extra_cleaning",
  "grocery_stocking",
  "late_checkout",
] as const satisfies readonly ExtraSuggestion[];

export const ANSWER_REASONS = [
  "unavailable",
  "fully_booked",
  "too_late",
  "other",
] as const satisfies readonly ServiceRequestAnswerReason[];
