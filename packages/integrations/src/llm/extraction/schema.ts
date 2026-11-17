import { z } from "zod";

/**
 * What the model returns for a listing (research R6, FR-010, FR-019). Every field is nullable,
 * so "not found" is a valid answer and nothing has to be invented. Formats such as `HH:MM` and
 * the guest range are checked again in the domain after the call.
 */
export const listingExtractionSchema = z.object({
  /** BCP 47 tag of the listing's language, for example `es` or `en`. */
  language: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  /** House rules as written, one rule per line. */
  houseRules: z.string().nullable(),
  /** Short amenity labels as written in the listing. */
  amenities: z.array(z.string()).nullable(),
  /** `HH:MM`, 24-hour. */
  checkInTime: z.string().nullable(),
  checkoutTime: z.string().nullable(),
  maxGuests: z.number().int().nullable(),
});
export type ListingExtraction = z.infer<typeof listingExtractionSchema>;
