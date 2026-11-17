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
import { PMS_PROVIDERS } from "./enums.js";
import { extractionRequest } from "./extractions.js";
import { workspaceDataKey } from "./keys.js";
import { pmsConnection } from "./pms.js";
import { workspace } from "./tenancy.js";

export const PROPERTY_SETUP_STATUSES = ["needs_details", "to_confirm", "ready"] as const;
export const PROPERTY_SOURCES = ["manual", "listing_text", "csv", "pms", "duplicate"] as const;
export { PMS_PROVIDERS };
export const PROPERTY_PMS_STATUSES = ["linked", "not_found"] as const;
export const PROPERTY_STATUSES = ["active", "removed"] as const;
export const GUIDE_LANGUAGES = ["es", "en"] as const;

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
    label: text("label"),
    valueCiphertext: bytea("value_ciphertext").notNull(),
    dataKeyId: uuid("data_key_id")
      .notNull()
      .references(() => workspaceDataKey.id),
    source: text("source", { enum: ["pms"] }).notNull(),
    /** Where it was found, for example `beds24:houseRules`, for re-import matching. */
    sourceField: text("source_field").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("restricted_value_property_idx").on(t.propertyId, t.sourceField),
    index("restricted_value_workspace_idx").on(t.workspaceId),
    check("restricted_value_kind_valid", inList(t.kind, RESTRICTED_VALUE_KINDS)),
    check(
      "restricted_value_label_length",
      sql`${t.label} IS NULL OR char_length(${t.label}) <= 80`,
    ),
    check("restricted_value_source_valid", sql`${t.source} = 'pms'`),
    check(
      "restricted_value_source_field_length",
      sql`char_length(${t.sourceField}) BETWEEN 1 AND 80`,
    ),
  ],
);
