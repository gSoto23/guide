/**
 * Calendar feeds and stays (feature 002 data model §3). Agents read feeds only through the
 * `calendar_feed_public` view (migration 0017), which leaves out the link columns (FR-025).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
import { workspaceDataKey } from "./keys.js";
import { pmsConnection } from "./pms.js";
import { property } from "./properties.js";
import { workspace } from "./tenancy.js";

export const FEED_CHANNELS = ["airbnb", "booking", "vrbo", "other"] as const;
export const FEED_STATUSES = ["active", "failing"] as const;

export const calendarFeed = pgTable(
  "calendar_feed",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: FEED_CHANNELS }).notNull(),
    channelLabel: text("channel_label"),
    /** Restricted (FR-025). */
    urlCiphertext: bytea("url_ciphertext").notNull(),
    /** HMAC-SHA-256 of the normalized link with FEED_URL_PEPPER. */
    urlFingerprint: text("url_fingerprint").notNull(),
    /** Masked form, for example `airbnb.com/…/a1b2.ics`. */
    displayHint: text("display_hint").notNull(),
    dataKeyId: uuid("data_key_id")
      .notNull()
      .references(() => workspaceDataKey.id),
    status: text("status", { enum: FEED_STATUSES }).notNull().default("active"),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    failingSince: timestamp("failing_since", { withTimezone: true }),
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    manualRefreshAt: timestamp("manual_refresh_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("calendar_feed_fingerprint_uq").on(t.propertyId, t.urlFingerprint),
    // One feed per channel (FR-020); several `other` feeds need distinct labels.
    uniqueIndex("calendar_feed_channel_uq")
      .on(t.propertyId, t.channel)
      .where(sql`${t.channel} <> 'other'`),
    uniqueIndex("calendar_feed_other_label_uq")
      .on(t.propertyId, t.channelLabel)
      .where(sql`${t.channel} = 'other'`),
    index("calendar_feed_workspace_idx").on(t.workspaceId),
    index("calendar_feed_due_idx").on(t.lastSuccessAt),
    check("calendar_feed_channel_valid", inList(t.channel, FEED_CHANNELS)),
    check(
      "calendar_feed_channel_label",
      sql`(${t.channel} <> 'other' OR ${t.channelLabel} IS NOT NULL)
        AND (${t.channelLabel} IS NULL OR char_length(${t.channelLabel}) BETWEEN 1 AND 40)`,
    ),
    check("calendar_feed_status_valid", inList(t.status, FEED_STATUSES)),
    check(
      "calendar_feed_error_code_length",
      sql`${t.lastErrorCode} IS NULL OR char_length(${t.lastErrorCode}) <= 40`,
    ),
  ],
);

export const STAY_SOURCES = ["ical", "pms", "manual"] as const;
export const STAY_STATUSES = ["active", "cancelled", "hidden"] as const;
/** Where a stay's guest name and number of guests came from (feature 018). */
export const GUEST_DETAILS_SOURCES = ["feed", "pms", "host"] as const;

export const stay = pgTable(
  "stay",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    source: text("source", { enum: STAY_SOURCES }).notNull(),
    calendarFeedId: uuid("calendar_feed_id").references(() => calendarFeed.id, {
      onDelete: "cascade",
    }),
    pmsConnectionId: uuid("pms_connection_id").references((): AnyPgColumn => pmsConnection.id, {
      onDelete: "set null",
    }),
    /** iCal UID or PMS booking ID. */
    externalUid: text("external_uid"),
    checkInDate: date("check_in_date").notNull(),
    checkoutDate: date("checkout_date").notNull(),
    /** Null uses the property's times; set only for manual stays (FR-052). */
    checkInTime: time("check_in_time"),
    checkoutTime: time("checkout_time"),
    channel: text("channel").notNull(),
    status: text("status", { enum: STAY_STATUSES }).notNull().default("active"),
    /** Unlabeled feed entry (FR-022). */
    mayBeBlock: boolean("may_be_block").notNull().default(false),
    guestCount: smallint("guest_count"),
    /** Confidential. PMS or manual only (FR-030, FR-052). */
    guestName: text("guest_name"),
    /** Refreshes never write `guest_name` again while this is set (FR-053). */
    guestNameRemovedAt: timestamp("guest_name_removed_at", { withTimezone: true }),
    bookingReference: text("booking_reference"),
    /**
     * Feature 018: who set the guest name and number of guests. `host` values are never
     * overwritten by feed or PMS refreshes (FR-016).
     */
    guestDetailsSource: text("guest_details_source", { enum: GUEST_DETAILS_SOURCES }),
    guestDetailsBy: text("guest_details_by").references(() => user.id, { onDelete: "set null" }),
    guestDetailsAt: timestamp("guest_details_at", { withTimezone: true }),
    duplicateOfId: uuid("duplicate_of_id").references((): AnyPgColumn => stay.id, {
      onDelete: "set null",
    }),
    overlaps: boolean("overlaps").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /**
     * Feature 010 (research R4): the first time a stay link of this stay started a guest session.
     * Not personal data; kept as long as the stay, because stay links and sessions are deleted 30
     * days after checkout.
     */
    guideOpenedAt: timestamp("guide_opened_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("stay_feed_uid_uq").on(t.calendarFeedId, t.externalUid),
    uniqueIndex("stay_pms_uid_uq")
      .on(t.pmsConnectionId, t.externalUid)
      .where(sql`${t.pmsConnectionId} IS NOT NULL`),
    index("stay_property_dates_idx").on(t.propertyId, t.checkoutDate),
    index("stay_workspace_idx").on(t.workspaceId),
    index("stay_property_opened_idx")
      .on(t.propertyId, t.guideOpenedAt)
      .where(sql`${t.guideOpenedAt} IS NOT NULL`),
    index("stay_guest_name_retention_idx")
      .on(t.checkoutDate)
      .where(sql`${t.guestName} IS NOT NULL`),
    check("stay_dates_order", sql`${t.checkoutDate} > ${t.checkInDate}`),
    check("stay_source_valid", inList(t.source, STAY_SOURCES)),
    check("stay_status_valid", inList(t.status, STAY_STATUSES)),
    check(
      "stay_source_links",
      sql`(${t.source} = 'ical' AND ${t.calendarFeedId} IS NOT NULL AND ${t.externalUid} IS NOT NULL)
        OR (${t.source} = 'pms' AND ${t.calendarFeedId} IS NULL AND ${t.externalUid} IS NOT NULL)
        OR (${t.source} = 'manual' AND ${t.calendarFeedId} IS NULL AND ${t.pmsConnectionId} IS NULL)`,
    ),
    check("stay_channel_length", sql`char_length(${t.channel}) BETWEEN 1 AND 40`),
    check(
      "stay_guest_fields",
      sql`(${t.guestName} IS NULL OR char_length(${t.guestName}) <= 120)
        AND (${t.guestCount} IS NULL OR ${t.guestCount} BETWEEN 0 AND 500)
        AND (${t.bookingReference} IS NULL OR char_length(${t.bookingReference}) <= 80)`,
    ),
    // Feed entries carry no guest data (FR-022); feature 018 keeps the reservation code as the
    // booking reference and allows a name and number of guests typed by the host.
    check(
      "stay_ical_guest_data",
      sql`${t.source} <> 'ical' OR ${t.guestDetailsSource} = 'host' OR (${t.guestName} IS NULL AND ${t.guestCount} IS NULL)`,
    ),
    check(
      "stay_guest_details_source_valid",
      sql`${t.guestDetailsSource} IS NULL OR ${inList(t.guestDetailsSource, GUEST_DETAILS_SOURCES)}`,
    ),
    check(
      "stay_guest_name_removed",
      sql`${t.guestNameRemovedAt} IS NULL OR ${t.guestName} IS NULL`,
    ),
  ],
);
