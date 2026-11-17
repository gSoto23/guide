/**
 * Plain value lists shared by the schemas and the portal. No zod here: client components import
 * them from "@guidesk/contracts/values" so zod stays out of the browser bundle (T101).
 */
export const PROPERTIES_BUCKET_VALUES = ["1_2", "3_10", "10_plus"] as const;
export const PMS_VALUES = [
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

/** Feature 002 value lists (data model §1). */
export const GUIDE_LANGUAGE_VALUES = ["es", "en"] as const;
export const SETUP_STATUS_VALUES = ["needs_details", "to_confirm", "ready"] as const;
export const PROPERTY_SOURCE_VALUES = [
  "manual",
  "listing_text",
  "csv",
  "pms",
  "duplicate",
] as const;
export const PMS_PROVIDER_VALUES = ["beds24", "hostex"] as const;
export const START_OPTION_VALUES = ["listing", "pms", "csv", "duplicate", "blank"] as const;
export const LISTING_CONTENT_KIND_VALUES = [
  "title",
  "description",
  "house_rules",
  "amenities",
] as const;
export const LISTING_CONTENT_SOURCE_VALUES = [
  "listing_text",
  "screenshot",
  "pms",
  "duplicate",
] as const;
export const REVIEW_STATE_VALUES = ["unreviewed", "edited", "approved"] as const;
/** Required core facts (FR-001), in the order the confirmation step shows them. */
export const REQUIRED_FACT_VALUES = [
  "name",
  "addressLine1",
  "city",
  "country",
  "timeZone",
  "checkInTime",
  "checkoutTime",
  "maxGuests",
  "guideLanguages",
] as const;
