/**
 * Extras and add-on requests (feature 008 data model): the per-property catalog, the stays' requests
 * with what the guest saw when requesting, and daily counts. RLS, grants, and triggers are in
 * migration 0033.
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
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { inList } from "./columns.js";
import { property } from "./properties.js";
import { stay } from "./stays.js";
import { workspace } from "./tenancy.js";

export const EXTRA_CURRENCIES = ["USD", "CRC", "MXN", "EUR", "COP", "GTQ"] as const;
export const EXTRA_DATE_RANGES = ["stay", "before_arrival"] as const;
export const EXTRA_TURNOVERS = ["early_check_in", "late_checkout"] as const;
export const EXTRA_LANGUAGES = ["es", "en"] as const;
export const SERVICE_REQUEST_STATUSES = [
  "waiting",
  "confirmed",
  "declined",
  "cancelled",
  "host_cancelled",
  "expired",
] as const;
export const SERVICE_REQUEST_REASONS = [
  "unavailable",
  "fully_booked",
  "too_late",
  "other",
  "stay",
] as const;

type Localized = Partial<Record<(typeof EXTRA_LANGUAGES)[number], string>>;

export const extra = pgTable(
  "extra",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    sourceLanguage: text("source_language", { enum: EXTRA_LANGUAGES }).notNull(),
    name: jsonb("name").$type<Localized>().notNull(),
    description: jsonb("description").$type<Localized>().notNull().default({}),
    price: numeric("price", { precision: 10, scale: 2, mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    leadTimeHours: integer("lead_time_hours").notNull().default(0),
    weekdays: smallint("weekdays")
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5,6,7}'::smallint[]`),
    needsDate: boolean("needs_date").notNull().default(false),
    needsTime: boolean("needs_time").notNull().default(false),
    dateRange: text("date_range", { enum: EXTRA_DATE_RANGES }).notNull().default("stay"),
    maxPerStay: integer("max_per_stay").notNull().default(1),
    preApproved: boolean("pre_approved").notNull().default(false),
    turnover: text("turnover", { enum: EXTRA_TURNOVERS }),
    visible: boolean("visible").notNull().default(true),
    position: integer("position").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("extra_property_idx").on(t.propertyId, t.position),
    check("extra_source_language_valid", inList(t.sourceLanguage, EXTRA_LANGUAGES)),
    check(
      "extra_name_valid",
      sql`jsonb_typeof(${t.name}) = 'object' AND ${t.name} ? ${t.sourceLanguage}
        AND char_length(coalesce(${t.name}->>'es', 'x')) BETWEEN 1 AND 80
        AND char_length(coalesce(${t.name}->>'en', 'x')) BETWEEN 1 AND 80`,
    ),
    check(
      "extra_description_valid",
      sql`jsonb_typeof(${t.description}) = 'object'
        AND char_length(coalesce(${t.description}->>'es', '')) <= 500
        AND char_length(coalesce(${t.description}->>'en', '')) <= 500`,
    ),
    check("extra_price", sql`${t.price} BETWEEN 0 AND 100000`),
    check("extra_currency_valid", inList(t.currency, EXTRA_CURRENCIES)),
    check("extra_lead_time", sql`${t.leadTimeHours} BETWEEN 0 AND 720`),
    check(
      "extra_weekdays_valid",
      sql`cardinality(${t.weekdays}) BETWEEN 1 AND 7 AND ${t.weekdays} <@ '{1,2,3,4,5,6,7}'::smallint[]`,
    ),
    check(
      "extra_time_needs_date",
      sql`NOT ${t.needsTime} OR ${t.needsDate} OR ${t.turnover} IS NOT NULL`,
    ),
    check("extra_date_range_valid", inList(t.dateRange, EXTRA_DATE_RANGES)),
    check("extra_max_per_stay", sql`${t.maxPerStay} BETWEEN 1 AND 10`),
    check(
      "extra_turnover_valid",
      sql`${t.turnover} IS NULL OR (${inList(t.turnover, EXTRA_TURNOVERS)} AND NOT ${t.needsDate})`,
    ),
    check("extra_position", sql`${t.position} >= 0`),
    check("extra_version", sql`${t.version} >= 1`),
  ],
);

export const serviceRequest = pgTable(
  "service_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    stayId: uuid("stay_id")
      .notNull()
      .references(() => stay.id, { onDelete: "cascade" }),
    extraId: uuid("extra_id").references(() => extra.id, { onDelete: "set null" }),
    extraName: jsonb("extra_name").$type<Localized>().notNull(),
    sourceLanguage: text("source_language", { enum: EXTRA_LANGUAGES }).notNull(),
    price: numeric("price", { precision: 10, scale: 2, mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    requestedDate: date("requested_date"),
    requestedTime: time("requested_time"),
    quantity: integer("quantity").notNull().default(1),
    note: text("note"),
    status: text("status", { enum: SERVICE_REQUEST_STATUSES }).notNull().default("waiting"),
    reasonCode: text("reason_code", { enum: SERVICE_REQUEST_REASONS }),
    reasonText: text("reason_text"),
    answeredBy: text("answered_by").references(() => user.id, { onDelete: "set null" }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("service_request_status_idx").on(t.workspaceId, t.status, t.expiresAt),
    index("service_request_stay_idx").on(t.stayId, t.createdAt),
    index("service_request_unnotified_idx")
      .on(t.createdAt)
      .where(sql`${t.notifiedAt} IS NULL`),
    check("service_request_status_valid", inList(t.status, SERVICE_REQUEST_STATUSES)),
    check("service_request_currency_valid", inList(t.currency, EXTRA_CURRENCIES)),
    check("service_request_price", sql`${t.price} BETWEEN 0 AND 100000`),
    check("service_request_quantity", sql`${t.quantity} BETWEEN 1 AND 10`),
    check(
      "service_request_note_len",
      sql`${t.note} IS NULL OR char_length(${t.note}) BETWEEN 1 AND 300`,
    ),
    check(
      "service_request_reason_valid",
      sql`${t.reasonCode} IS NULL OR ${inList(t.reasonCode, SERVICE_REQUEST_REASONS)}`,
    ),
    check(
      "service_request_reason_text_len",
      sql`${t.reasonText} IS NULL OR char_length(${t.reasonText}) BETWEEN 1 AND 200`,
    ),
    check(
      "service_request_answered",
      sql`(${t.answeredBy} IS NULL) OR (${t.answeredAt} IS NOT NULL)`,
    ),
  ],
);

export const serviceRequestDaily = pgTable(
  "service_request_daily",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    status: text("status", { enum: SERVICE_REQUEST_STATUSES }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.day, t.status] }),
    index("service_request_daily_workspace_idx").on(t.workspaceId),
    check("service_request_daily_status_valid", inList(t.status, SERVICE_REQUEST_STATUSES)),
    check("service_request_daily_count", sql`${t.count} >= 0`),
  ],
);
