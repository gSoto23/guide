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

/** Feature 003 value lists (data model §1–§5). */
export const SECTION_KIND_VALUES = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
  "custom",
] as const;
export const DEFAULT_SECTION_KIND_VALUES = SECTION_KIND_VALUES.filter(
  (kind): kind is Exclude<(typeof SECTION_KIND_VALUES)[number], "custom"> => kind !== "custom",
);
export const SECTION_STATUS_VALUES = ["missing", "needs_review", "ready"] as const;
export const GUIDE_STATUS_VALUES = ["draft", "published", "unpublished"] as const;
export const GUIDE_DRAFT_STATE_VALUES = [
  "pending",
  "drafting",
  "ready",
  "waiting_limit",
  "failed",
] as const;
export const GUIDE_ITEM_KIND_VALUES = ["text", "image", "video", "recommendation", "fact"] as const;
export const GUIDE_ITEM_SOURCE_VALUES = [
  "host",
  "listing",
  "pms",
  "document",
  "interview",
  "copy",
] as const;
export const FACT_KEY_VALUES = ["check_in_time", "checkout_time", "max_guests", "address"] as const;
export const TEXT_ORIGIN_VALUES = ["source", "machine", "reviewed"] as const;
export const TEXT_STATE_VALUES = ["current", "stale", "out_of_date", "pending", "failed"] as const;
export const TEXT_PENDING_REASON_VALUES = [
  "ai_limit",
  "ai_unavailable",
  "tokens_mismatch",
] as const;
export const RECOMMENDATION_CATEGORY_VALUES = [
  "restaurant",
  "grocery",
  "beach",
  "activity",
  "shopping",
  "transport",
  "service",
  "other",
] as const;
export const BENEFIT_VALUES = ["none", "commission", "discount", "other"] as const;
export const MEDIA_KIND_VALUES = ["image", "video"] as const;
export const MEDIA_STATUS_VALUES = ["uploading", "processing", "ready", "rejected"] as const;
export const LOCKED_FIELD_KIND_VALUES = [
  "door_code",
  "gate_code",
  "lockbox_code",
  "alarm_code",
  "wifi_password",
  "other",
] as const;
export const TOPIC_MARK_VALUES = ["covered", "not_applicable"] as const;

/** Feature 009: Explore categories, in display order (research R6). Zod-free for portal clients. */
export const EXPLORE_CATEGORY_VALUES = [
  "tours",
  "food_drink",
  "outdoor",
  "water",
  "culture",
  "day_trips",
  "other",
] as const;
