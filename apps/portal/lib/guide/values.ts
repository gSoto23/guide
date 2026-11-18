import type {
  BENEFIT_VALUES,
  LOCKED_FIELD_KIND_VALUES,
  RECOMMENDATION_CATEGORY_VALUES,
} from "@guidesk/contracts/values";

/**
 * Guide editor lists for the portal (features 003 and 004). Kept here instead of importing
 * `@guidesk/contracts/values` at run time, so the section editor route doesn't download every
 * list in the product (plan Performance Budget, 150 KB per route). The checks below fail the
 * build when a list drifts from the contracts in either direction.
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const RECOMMENDATION_CATEGORIES = [
  "restaurant",
  "grocery",
  "beach",
  "activity",
  "shopping",
  "transport",
  "service",
  "other",
] as const;
export const BENEFITS = ["none", "commission", "discount", "other"] as const;
export const LOCKED_FIELD_KINDS = [
  "door_code",
  "gate_code",
  "lockbox_code",
  "alarm_code",
  "wifi_password",
  "other",
] as const;

export const listsMatchContracts: [
  Same<(typeof RECOMMENDATION_CATEGORIES)[number], (typeof RECOMMENDATION_CATEGORY_VALUES)[number]>,
  Same<(typeof BENEFITS)[number], (typeof BENEFIT_VALUES)[number]>,
  Same<(typeof LOCKED_FIELD_KINDS)[number], (typeof LOCKED_FIELD_KIND_VALUES)[number]>,
] = [true, true, true];
