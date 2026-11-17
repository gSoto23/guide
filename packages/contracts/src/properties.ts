import { z } from "zod";
import { contentItemInputSchema } from "./listing-content.js";
import {
  GUIDE_LANGUAGE_VALUES,
  PMS_PROVIDER_VALUES,
  PROPERTY_SOURCE_VALUES,
  REQUIRED_FACT_VALUES,
  SETUP_STATUS_VALUES,
  START_OPTION_VALUES,
} from "./values.js";

/** Contracts for properties (feature 002 contracts/http-api.md, data model §1). */
export const guideLanguageSchema = z.enum(GUIDE_LANGUAGE_VALUES);
export const setupStatusSchema = z.enum(SETUP_STATUS_VALUES);
export const propertySourceSchema = z.enum(PROPERTY_SOURCE_VALUES);
export const pmsProviderSchema = z.enum(PMS_PROVIDER_VALUES);
export const requiredFactSchema = z.enum(REQUIRED_FACT_VALUES);

/** `HH:MM`, 24-hour, read in the property's time zone (FR-005). */
export const timeOfDaySchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, "Use an ISO 3166-1 alpha-2 code");
/** An IANA zone name; the API also checks that the runtime knows it. */
export const timeZoneSchema = z.string().regex(/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$|^UTC$/);

const guideLanguagesSchema = z
  .array(guideLanguageSchema)
  .min(1)
  .max(2)
  .refine((languages) => new Set(languages).size === languages.length, "Languages repeat");

/** Optional text: blank becomes null, so clearing a field works from any form. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value));

/** Every core fact (FR-001), each optional, for edits. */
export const coreFactsPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    addressLine1: optionalText(200),
    addressUnit: optionalText(100),
    city: optionalText(120),
    region: optionalText(120),
    postalCode: optionalText(20),
    country: countryCodeSchema.nullable(),
    timeZone: timeZoneSchema.nullable(),
    checkInTime: timeOfDaySchema.nullable(),
    checkoutTime: timeOfDaySchema.nullable(),
    maxGuests: z.number().int().min(1).max(50).nullable(),
    guideLanguages: guideLanguagesSchema,
  })
  .partial()
  .strict();

/** PATCH /properties/{id}: at least one fact (FR-005). */
export const updatePropertySchema = coreFactsPatchSchema.refine(
  (body) => Object.keys(body).length > 0,
  "Change at least one fact",
);
export type UpdatePropertyBody = z.infer<typeof updatePropertySchema>;

/** The confirmation step requires every required fact (FR-001, FR-004). */
export const createPropertySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    addressLine1: z.string().trim().min(1).max(200),
    addressUnit: optionalText(100),
    city: z.string().trim().min(1).max(120),
    region: optionalText(120),
    postalCode: optionalText(20),
    country: countryCodeSchema,
    timeZone: timeZoneSchema,
    checkInTime: timeOfDaySchema,
    checkoutTime: timeOfDaySchema,
    maxGuests: z.number().int().min(1).max(50),
    guideLanguages: guideLanguagesSchema,
    source: z.enum(["manual", "listing_text", "duplicate"]).default("manual"),
    /** Listing text: the extraction whose items were accepted (US2). */
    extractionRequestId: z.uuid().optional(),
    /** Duplicate: the property it was copied from (US6). */
    duplicateOf: z.uuid().optional(),
    contentItems: z.array(contentItemInputSchema).max(4).optional(),
  })
  .strict()
  .refine((body) => body.source !== "listing_text" || body.extractionRequestId, {
    message: "extractionRequestId is required for listing text",
    path: ["extractionRequestId"],
  })
  .refine((body) => body.source !== "duplicate" || body.duplicateOf, {
    message: "duplicateOf is required for a duplicate",
    path: ["duplicateOf"],
  });
export type CreatePropertyBody = z.infer<typeof createPropertySchema>;

export const listPropertiesQuerySchema = z
  .object({
    query: z.string().trim().max(120).optional(),
    cursor: z.string().max(200).optional(),
    /** Removed properties are listed only for owners and admins. */
    status: z.enum(["active", "removed"]).default("active"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListPropertiesQuery = z.infer<typeof listPropertiesQuerySchema>;

/** Calendar status in the list (FR-006): no feed, all feeds working, or one failing. */
export const calendarStatusSchema = z.enum(["none", "ok", "failing"]);

export const propertySummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  setupStatus: setupStatusSchema,
  missingFacts: z.array(requiredFactSchema),
  source: propertySourceSchema,
  sourceProvider: pmsProviderSchema.nullable(),
  pmsStatus: z.enum(["linked", "not_found"]).nullable(),
  calendarStatus: calendarStatusSchema,
  status: z.enum(["active", "removed"]),
  createdAt: z.iso.datetime(),
  /** When a removed property is deleted permanently (FR-045); null while active. */
  purgeAfter: z.iso.datetime().nullable(),
});
export type PropertySummary = z.infer<typeof propertySummarySchema>;

export const propertyListSchema = z.object({
  items: z.array(propertySummarySchema),
  nextCursor: z.string().nullable(),
});
export type PropertyList = z.infer<typeof propertyListSchema>;

export const propertyDetailSchema = propertySummarySchema.extend({
  addressLine1: z.string().nullable(),
  addressUnit: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string().nullable(),
  timeZone: z.string().nullable(),
  checkInTime: z.string().nullable(),
  checkoutTime: z.string().nullable(),
  maxGuests: z.number().int().nullable(),
  guideLanguages: z.array(guideLanguageSchema),
  editedFacts: z.array(z.string()),
  updatedAt: z.iso.datetime(),
  counts: z.object({
    stays: z.number().int(),
    /** Null for agents, who get no feed or restricted-value details. */
    feeds: z.number().int().nullable(),
    restrictedValues: z.number().int().nullable(),
  }),
});
export type PropertyDetail = z.infer<typeof propertyDetailSchema>;

export const propertyLimitsSchema = z.object({
  limit: z.number().int(),
  used: z.number().int(),
  extractionLimit: z.number().int(),
  extractionsUsedToday: z.number().int(),
});
export type PropertyLimits = z.infer<typeof propertyLimitsSchema>;

export const startOptionsSchema = z.object({
  options: z.array(z.object({ option: z.enum(START_OPTION_VALUES), recommended: z.boolean() })),
  screenshotsEnabled: z.boolean(),
  pmsProviders: z.array(pmsProviderSchema),
});
export type StartOptions = z.infer<typeof startOptionsSchema>;

export const addressCheckQuerySchema = z
  .object({
    line1: z.string().trim().min(1).max(200),
    unit: z.string().trim().max(100).optional(),
    city: z.string().trim().min(1).max(120),
    country: countryCodeSchema,
  })
  .strict();
export type AddressCheckQuery = z.infer<typeof addressCheckQuerySchema>;

export const addressCheckSchema = z.object({
  matches: z.array(z.object({ propertyId: z.uuid(), name: z.string() })),
});
export type AddressCheck = z.infer<typeof addressCheckSchema>;

export const confirmPropertiesSchema = z
  .object({ propertyIds: z.array(z.uuid()).min(1).max(500) })
  .strict();
export type ConfirmPropertiesBody = z.infer<typeof confirmPropertiesSchema>;

export const confirmPropertiesResultSchema = z.object({
  ready: z.array(z.uuid()),
  needsDetails: z.array(
    z.object({ propertyId: z.uuid(), missingFacts: z.array(requiredFactSchema) }),
  ),
});
export type ConfirmPropertiesResult = z.infer<typeof confirmPropertiesResultSchema>;
