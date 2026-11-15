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
