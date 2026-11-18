/**
 * Explore (feature 009 data model): partner experiences near properties, kept no longer than each
 * partner allows; host settings; and Explore counts. The partner tables are global public content,
 * written only by the worker; the tenant tables follow workspace RLS. RLS and grants are in
 * migration 0031.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { inList } from "./columns.js";
import { property } from "./properties.js";
import { workspace } from "./tenancy.js";

export const EXPLORE_CATEGORIES = [
  "tours",
  "food_drink",
  "outdoor",
  "water",
  "culture",
  "day_trips",
  "other",
] as const;
export const EXPLORE_PARTNERS = ["viator", "civitatis"] as const;
/** Partners whose content the worker stores (Civitatis is a curated file, research R3). */
export const STORED_PARTNERS = ["viator"] as const;
export const EXPLORE_LANGUAGES = ["es", "en"] as const;
export const REFRESH_ERRORS = ["timeout", "http_429", "http_4xx", "http_5xx", "invalid"] as const;
export const PARTNER_REFERENCE_KINDS = ["destinations", "tags"] as const;

const categoryList = sql.raw(EXPLORE_CATEGORIES.map((value) => `'${value}'`).join(","));

export const experienceDestination = pgTable(
  "experience_destination",
  {
    key: text("key").primaryKey(),
    country: char("country", { length: 2 }).notNull(),
    city: text("city").notNull(),
    region: text("region"),
    viatorDestinationId: text("viator_destination_id"),
    mappedAt: timestamp("mapped_at", { withTimezone: true }),
  },
  (t) => [
    check("experience_destination_key_len", sql`char_length(${t.key}) BETWEEN 4 AND 120`),
    check("experience_destination_city_len", sql`char_length(${t.city}) BETWEEN 1 AND 120`),
    check(
      "experience_destination_region_len",
      sql`${t.region} IS NULL OR char_length(${t.region}) <= 120`,
    ),
    check(
      "experience_destination_viator_id",
      sql`${t.viatorDestinationId} IS NULL OR ${t.viatorDestinationId} ~ '^[0-9]{1,12}$'`,
    ),
  ],
);

export const experienceRefresh = pgTable(
  "experience_refresh",
  {
    destinationKey: text("destination_key")
      .notNull()
      .references(() => experienceDestination.key, { onDelete: "cascade" }),
    partner: text("partner", { enum: STORED_PARTNERS }).notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    failures: integer("failures").notNull().default(0),
    lastError: text("last_error", { enum: REFRESH_ERRORS }),
  },
  (t) => [
    primaryKey({ columns: [t.destinationKey, t.partner] }),
    check("experience_refresh_partner_valid", inList(t.partner, STORED_PARTNERS)),
    check("experience_refresh_failures", sql`${t.failures} >= 0`),
    check(
      "experience_refresh_error_valid",
      sql`${t.lastError} IS NULL OR ${inList(t.lastError, REFRESH_ERRORS)}`,
    ),
  ],
);

export const experience = pgTable(
  "experience",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partner: text("partner", { enum: STORED_PARTNERS }).notNull(),
    productId: text("product_id").notNull(),
    destinationKey: text("destination_key")
      .notNull()
      .references(() => experienceDestination.key, { onDelete: "cascade" }),
    language: text("language", { enum: EXPLORE_LANGUAGES }).notNull(),
    category: text("category", { enum: EXPLORE_CATEGORIES }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    includes: text("includes"),
    durationMinutes: integer("duration_minutes"),
    priceFrom: numeric("price_from", { precision: 12, scale: 2, mode: "number" }),
    currency: char("currency", { length: 3 }),
    rating: numeric("rating", { precision: 3, scale: 2, mode: "number" }),
    reviewCount: integer("review_count"),
    imageUrl: text("image_url"),
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),
    partnerUrl: text("partner_url").notNull(),
    machineTranslated: boolean("machine_translated").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    unique("experience_product_uq").on(t.partner, t.productId, t.destinationKey, t.language),
    index("experience_destination_idx").on(t.destinationKey, t.expiresAt),
    check("experience_partner_valid", inList(t.partner, STORED_PARTNERS)),
    check("experience_language_valid", inList(t.language, EXPLORE_LANGUAGES)),
    check("experience_category_valid", sql`${t.category} IN (${categoryList})`),
    check("experience_product_id", sql`${t.productId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check("experience_title_len", sql`char_length(${t.title}) BETWEEN 1 AND 200`),
    check("experience_description_len", sql`char_length(${t.description}) <= 2000`),
    check(
      "experience_includes_len",
      sql`${t.includes} IS NULL OR char_length(${t.includes}) <= 1000`,
    ),
    check(
      "experience_duration",
      sql`${t.durationMinutes} IS NULL OR ${t.durationMinutes} BETWEEN 1 AND 20160`,
    ),
    check(
      "experience_price",
      sql`(${t.priceFrom} IS NULL) = (${t.currency} IS NULL) AND (${t.priceFrom} IS NULL OR ${t.priceFrom} >= 0)`,
    ),
    check("experience_currency", sql`${t.currency} IS NULL OR ${t.currency} ~ '^[A-Z]{3}$'`),
    check("experience_rating", sql`${t.rating} IS NULL OR ${t.rating} BETWEEN 0 AND 5`),
    check("experience_reviews", sql`${t.reviewCount} IS NULL OR ${t.reviewCount} >= 0`),
    check(
      "experience_image",
      sql`(${t.imageUrl} IS NULL OR (${t.imageUrl} LIKE 'https://%' AND char_length(${t.imageUrl}) <= 2000))
        AND ((${t.imageUrl} IS NULL) = (${t.imageWidth} IS NULL))
        AND ((${t.imageUrl} IS NULL) = (${t.imageHeight} IS NULL))`,
    ),
    check(
      "experience_partner_url",
      sql`${t.partnerUrl} LIKE 'https://%' AND char_length(${t.partnerUrl}) <= 2000`,
    ),
    check("experience_expiry", sql`${t.expiresAt} > ${t.fetchedAt}`),
  ],
);

export const experiencePartnerReference = pgTable(
  "experience_partner_reference",
  {
    partner: text("partner", { enum: STORED_PARTNERS }).notNull(),
    kind: text("kind", { enum: PARTNER_REFERENCE_KINDS }).notNull(),
    data: jsonb("data").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.partner, t.kind] }),
    check("experience_partner_reference_partner_valid", inList(t.partner, STORED_PARTNERS)),
    check("experience_partner_reference_kind_valid", inList(t.kind, PARTNER_REFERENCE_KINDS)),
  ],
);

export const exploreSettings = pgTable(
  "explore_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Null for the workspace default. */
    propertyId: uuid("property_id").references(() => property.id, { onDelete: "cascade" }),
    followsDefault: boolean("follows_default").notNull().default(true),
    experiencesEnabled: boolean("experiences_enabled").notNull().default(true),
    hiddenCategories: text("hidden_categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    hiddenExperiences: text("hidden_experiences")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    version: integer("version").notNull().default(0),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("explore_settings_scope_uq").on(t.workspaceId, t.propertyId).nullsNotDistinct(),
    check(
      "explore_settings_categories_valid",
      sql`${t.hiddenCategories} <@ ARRAY[${categoryList}]::text[]`,
    ),
    check("explore_settings_hidden_len", sql`cardinality(${t.hiddenExperiences}) <= 200`),
    check(
      "explore_settings_workspace_row",
      sql`${t.propertyId} IS NOT NULL OR (${t.followsDefault} AND cardinality(${t.hiddenExperiences}) = 0)`,
    ),
    check("explore_settings_version", sql`${t.version} >= 0`),
  ],
);

export const exploreOpenDaily = pgTable(
  "explore_open_daily",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    opens: integer("opens").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.day] }),
    index("explore_open_daily_workspace_idx").on(t.workspaceId),
    check("explore_open_daily_opens", sql`${t.opens} >= 0`),
  ],
);

export const experienceClickDaily = pgTable(
  "experience_click_daily",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    partner: text("partner", { enum: EXPLORE_PARTNERS }).notNull(),
    ref: text("ref").notNull(),
    clicks: integer("clicks").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.day, t.ref] }),
    index("experience_click_daily_workspace_idx").on(t.workspaceId),
    check("experience_click_daily_partner_valid", inList(t.partner, EXPLORE_PARTNERS)),
    check("experience_click_daily_ref", sql`${t.ref} ~ '^(viator|civitatis)-[A-Za-z0-9_-]{1,64}$'`),
    check("experience_click_daily_clicks", sql`${t.clicks} >= 0`),
  ],
);
