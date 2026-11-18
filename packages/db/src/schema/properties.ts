/**
 * Properties, their listing content, and restricted values imported from a PMS (feature 002
 * data model §1). RLS policies, grants, and triggers live in migration 0017.
 */
import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { bytea, createdAt, inList, updatedAt } from "./columns.js";
import { GUIDE_LANGUAGES, PMS_PROVIDERS } from "./enums.js";
import { extractionRequest } from "./extractions.js";
import { workspaceDataKey } from "./keys.js";
import { pmsConnection } from "./pms.js";
import { workspace } from "./tenancy.js";

export const PROPERTY_SETUP_STATUSES = ["needs_details", "to_confirm", "ready"] as const;
export const PROPERTY_SOURCES = ["manual", "listing_text", "csv", "pms", "duplicate"] as const;
export { PMS_PROVIDERS };
export const PROPERTY_PMS_STATUSES = ["linked", "not_found"] as const;
export const PROPERTY_STATUSES = ["active", "removed"] as const;
export { GUIDE_LANGUAGES };

export const property = pgTable(
  "property",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    addressLine1: text("address_line1"),
    addressUnit: text("address_unit"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    /** ISO 3166-1 alpha-2. */
    country: char("country", { length: 2 }),
    /** Normalized line 1 + unit + city + country, for the duplicate-address warning (FR-007). */
    addressKey: text("address_key"),
    /** IANA zone (FR-002). */
    timeZone: text("time_zone"),
    checkInTime: time("check_in_time"),
    checkoutTime: time("checkout_time"),
    maxGuests: smallint("max_guests"),
    guideLanguages: text("guide_languages", { enum: GUIDE_LANGUAGES }).array().notNull(),
    /** Feature 005: overrides the workspace's assistant autonomy; null follows it (FR-022). */
    assistantAutonomy: text("assistant_autonomy", { enum: ["draft", "auto"] }),
    setupStatus: text("setup_status", { enum: PROPERTY_SETUP_STATUSES }).notNull(),
    missingFacts: text("missing_facts")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Facts the host changed after an import; a re-import never overwrites them (FR-033). */
    editedFacts: text("edited_facts")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: text("source", { enum: PROPERTY_SOURCES }).notNull(),
    sourceProvider: text("source_provider", { enum: PMS_PROVIDERS }),
    pmsConnectionId: uuid("pms_connection_id").references((): AnyPgColumn => pmsConnection.id, {
      onDelete: "set null",
    }),
    externalId: text("external_id"),
    pmsStatus: text("pms_status", { enum: PROPERTY_PMS_STATUSES }),
    duplicatedFromId: uuid("duplicated_from_id").references((): AnyPgColumn => property.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: PROPERTY_STATUSES }).notNull().default("active"),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: text("removed_by").references(() => user.id, { onDelete: "set null" }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("property_workspace_status_idx").on(t.workspaceId, t.status, t.createdAt),
    index("property_address_key_idx").on(t.workspaceId, t.addressKey),
    // Re-imports match by the PMS listing ID (FR-033).
    uniqueIndex("property_external_uq")
      .on(t.workspaceId, t.sourceProvider, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL`),
    index("property_pms_connection_idx").on(t.pmsConnectionId),
    index("property_purge_idx")
      .on(t.purgeAfter)
      .where(sql`${t.status} = 'removed'`),
    check("property_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check(
      "property_address_line1_length",
      sql`${t.addressLine1} IS NULL OR char_length(${t.addressLine1}) BETWEEN 1 AND 200`,
    ),
    check(
      "property_address_parts_length",
      sql`(${t.addressUnit} IS NULL OR char_length(${t.addressUnit}) <= 100)
        AND (${t.region} IS NULL OR char_length(${t.region}) <= 120)
        AND (${t.postalCode} IS NULL OR char_length(${t.postalCode}) <= 20)`,
    ),
    check(
      "property_city_length",
      sql`${t.city} IS NULL OR char_length(${t.city}) BETWEEN 1 AND 120`,
    ),
    check("property_country_valid", sql`${t.country} IS NULL OR ${t.country} ~ '^[A-Z]{2}$'`),
    check(
      "property_max_guests_range",
      sql`${t.maxGuests} IS NULL OR ${t.maxGuests} BETWEEN 1 AND 50`,
    ),
    check(
      "property_guide_languages_valid",
      sql`cardinality(${t.guideLanguages}) >= 1 AND ${t.guideLanguages} <@ ARRAY['es', 'en']::text[]`,
    ),
    check("property_setup_status_valid", inList(t.setupStatus, PROPERTY_SETUP_STATUSES)),
    check("property_source_valid", inList(t.source, PROPERTY_SOURCES)),
    check(
      "property_source_provider_valid",
      sql`(${t.sourceProvider} IS NULL AND ${t.source} <> 'pms')
        OR (${t.sourceProvider} IN ('beds24', 'hostex') AND ${t.source} = 'pms')`,
    ),
    check(
      "property_pms_status_valid",
      sql`${t.pmsStatus} IS NULL OR ${t.pmsStatus} IN ('linked', 'not_found')`,
    ),
    check("property_status_valid", inList(t.status, PROPERTY_STATUSES)),
    check(
      "property_removed_fields",
      sql`(${t.status} = 'active' AND ${t.removedAt} IS NULL AND ${t.purgeAfter} IS NULL)
        OR (${t.status} = 'removed' AND ${t.removedAt} IS NOT NULL AND ${t.purgeAfter} IS NOT NULL)`,
    ),
  ],
);

export const LISTING_CONTENT_KINDS = ["title", "description", "house_rules", "amenities"] as const;
export const LISTING_CONTENT_SOURCES = ["listing_text", "screenshot", "pms", "duplicate"] as const;
export const REVIEW_STATES = ["unreviewed", "edited", "approved"] as const;

export const listingContent = pgTable(
  "listing_content",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LISTING_CONTENT_KINDS }).notNull(),
    body: text("body"),
    /** Amenities, one per item. */
    items: text("items").array(),
    /** BCP 47 tag detected at extraction; content keeps its language (FR-019). */
    language: text("language"),
    source: text("source", { enum: LISTING_CONTENT_SOURCES }).notNull(),
    reviewState: text("review_state", { enum: REVIEW_STATES }).notNull().default("unreviewed"),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    extractionRequestId: uuid("extraction_request_id").references(
      (): AnyPgColumn => extractionRequest.id,
      { onDelete: "set null" },
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("listing_content_property_kind_uq").on(t.propertyId, t.kind),
    index("listing_content_workspace_idx").on(t.workspaceId),
    check("listing_content_kind_valid", inList(t.kind, LISTING_CONTENT_KINDS)),
    check("listing_content_body_length", sql`${t.body} IS NULL OR char_length(${t.body}) <= 20000`),
    check("listing_content_items_count", sql`${t.items} IS NULL OR cardinality(${t.items}) <= 200`),
    check(
      "listing_content_language_length",
      sql`${t.language} IS NULL OR char_length(${t.language}) <= 35`,
    ),
    check("listing_content_source_valid", inList(t.source, LISTING_CONTENT_SOURCES)),
    check("listing_content_review_state_valid", inList(t.reviewState, REVIEW_STATES)),
  ],
);

export const RESTRICTED_VALUE_KINDS = [
  "door_code",
  "gate_code",
  "lockbox_code",
  "alarm_code",
  "wifi_password",
  "other",
] as const;

/**
 * Codes found in imported PMS text (FR-031). Shown masked; this feature never decrypts them
 * (revealing them is spec 003).
 */
export const RESTRICTED_VALUE_SOURCES = ["pms", "host", "copy"] as const;
/** Section kinds a locked field can be listed in (feature 003 data model §2). */
export const LOCKED_FIELD_SECTION_KINDS = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
] as const;

/**
 * Restricted values: codes imported from a PMS (feature 002) and the guide's locked fields
 * (feature 003 data model §2). The value columns are never selectable from a request; reveals go
 * through the API's reveal service (feature 003 research R4).
 */
export const restrictedValue = pgTable(
  "restricted_value",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: RESTRICTED_VALUE_KINDS }).notNull(),
    label: text("label").notNull(),
    /** Null means "not set" (a duplicated property's fields, feature 003 FR-067). */
    valueCiphertext: bytea("value_ciphertext"),
    dataKeyId: uuid("data_key_id").references(() => workspaceDataKey.id),
    /** A Wi-Fi password the host made public (feature 003 FR-021); then the ciphertext is null. */
    publicValue: text("public_value"),
    source: text("source", { enum: RESTRICTED_VALUE_SOURCES }).notNull(),
    /** Where it was found, for example `beds24:houseRules`, for re-import matching. */
    sourceField: text("source_field"),
    sectionKind: text("section_kind", { enum: LOCKED_FIELD_SECTION_KINDS })
      .notNull()
      .default("arrival"),
    valueSetAt: timestamp("value_set_at", { withTimezone: true }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("restricted_value_property_idx").on(t.propertyId, t.sourceField),
    index("restricted_value_workspace_idx").on(t.workspaceId),
    check("restricted_value_kind_valid", inList(t.kind, RESTRICTED_VALUE_KINDS)),
    check("restricted_value_label_length", sql`char_length(${t.label}) BETWEEN 1 AND 80`),
    check("restricted_value_source_valid", inList(t.source, RESTRICTED_VALUE_SOURCES)),
    check(
      "restricted_value_source_field_length",
      sql`${t.sourceField} IS NULL OR char_length(${t.sourceField}) BETWEEN 1 AND 80`,
    ),
    check(
      "restricted_value_pms_source_field",
      sql`${t.source} <> 'pms' OR ${t.sourceField} IS NOT NULL`,
    ),
    check("restricted_value_section_kind_valid", inList(t.sectionKind, LOCKED_FIELD_SECTION_KINDS)),
    check(
      "restricted_value_key_with_value",
      sql`(${t.valueCiphertext} IS NULL) = (${t.dataKeyId} IS NULL)`,
    ),
    check(
      "restricted_value_public_or_secret",
      sql`${t.publicValue} IS NULL OR ${t.valueCiphertext} IS NULL`,
    ),
    check(
      "restricted_value_public_wifi_only",
      sql`${t.publicValue} IS NULL OR (${t.kind} = 'wifi_password' AND char_length(${t.publicValue}) BETWEEN 1 AND 200)`,
    ),
  ],
);
