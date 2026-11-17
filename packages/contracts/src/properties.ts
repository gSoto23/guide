import { z } from "zod";
import { contentItemInputSchema, listingContentKindSchema } from "./listing-content.js";
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

/**
 * A code found in imported PMS text (FR-031), as owners and admins see it: its kind and label,
 * never the value. Revealing it belongs to the guide builder (spec 003).
 */
export const restrictedValueSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["door_code", "gate_code", "lockbox_code", "alarm_code", "wifi_password", "other"]),
  label: z.string().nullable(),
  source: z.literal("pms"),
  createdAt: z.iso.datetime(),
});
export type RestrictedValue = z.infer<typeof restrictedValueSchema>;

export const restrictedValueListSchema = z.object({ items: z.array(restrictedValueSchema) });
export type RestrictedValueList = z.infer<typeof restrictedValueListSchema>;

// --- Duplicate, remove, and restore (US6, FR-043 to FR-045) ---

/** `GET /properties/{id}/duplicate-draft?lang=`: the language of the "Copy of …" name. */
export const duplicateDraftQuerySchema = z
  .object({ lang: z.enum(["es", "en"]).default("es") })
  .strict();

/**
 * The confirmation step's prefill for a duplicate (FR-043): the facts without the address, and
 * the listing content. Feeds, stays, codes, and the PMS link are never part of it. Nothing is
 * created until `POST /properties` with `source: "duplicate"` and `duplicateOf`.
 */
export const duplicateDraftSchema = z.object({
  duplicateOf: z.uuid(),
  sourceName: z.string(),
  name: z.string(),
  country: z.string().nullable(),
  timeZone: z.string().nullable(),
  checkInTime: timeOfDaySchema.nullable(),
  checkoutTime: timeOfDaySchema.nullable(),
  maxGuests: z.number().int().nullable(),
  guideLanguages: z.array(guideLanguageSchema),
  content: z.array(
    z.object({
      kind: listingContentKindSchema,
      body: z.string().nullable(),
      items: z.array(z.string()).nullable(),
      language: z.string().nullable(),
    }),
  ),
});
export type DuplicateDraft = z.infer<typeof duplicateDraftSchema>;

/** `DELETE /properties/{id}?dryRun=true` lists the upcoming stays without removing anything. */
export const removePropertyQuerySchema = z
  .object({ dryRun: z.enum(["true", "false"]).default("false") })
  .strict();

/** The name typed to confirm (FR-044); not needed for a dry run. */
export const removePropertySchema = z
  .object({ typedName: z.string().max(200).optional() })
  .strict()
  .optional();
export type RemovePropertyBody = z.infer<typeof removePropertySchema>;

export const propertyRemovalSchema = z.object({
  removed: z.boolean(),
  /** When the property is deleted permanently; null for a dry run. */
  purgeAfter: z.iso.datetime().nullable(),
  /** Stays with checkout from today, to warn about before removing (FR-044). */
  upcomingStays: z.array(
    z.object({ checkInDate: z.iso.date(), checkoutDate: z.iso.date(), channel: z.string() }),
  ),
});
export type PropertyRemoval = z.infer<typeof propertyRemovalSchema>;
