import { z } from "zod";
import { countryCodeSchema } from "./properties.js";

/** Contracts for time zone suggestion (feature 002 FR-002, research R11). */
export const timeZonesQuerySchema = z.object({ country: countryCodeSchema }).strict();

export const timeZoneSuggestQuerySchema = z
  .object({ country: countryCodeSchema, city: z.string().trim().max(120).optional() })
  .strict();

export const timeZoneOptionSchema = z.object({
  id: z.string(),
  /** Local name in the requested language, for example "hora del centro de México". */
  name: z.string(),
  /** Current UTC offset, for example "UTC−06:00". */
  offset: z.string(),
});
export type TimeZoneOption = z.infer<typeof timeZoneOptionSchema>;

export const timeZoneListSchema = z.object({ zones: z.array(timeZoneOptionSchema) });
export type TimeZoneList = z.infer<typeof timeZoneListSchema>;

export const timeZoneSuggestionSchema = z.object({
  suggested: z.string().nullable(),
  choices: z.array(timeZoneOptionSchema),
});
export type TimeZoneSuggestion = z.infer<typeof timeZoneSuggestionSchema>;
