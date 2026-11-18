/**
 * Views created by custom migrations. They live outside src/schema so drizzle-kit, which only
 * generates tables, never tries to create them.
 */
import { boolean, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  LOCKED_FIELD_SECTION_KINDS,
  RESTRICTED_VALUE_KINDS,
  RESTRICTED_VALUE_SOURCES,
} from "./schema/properties.js";
import { FEED_CHANNELS, FEED_STATUSES } from "./schema/stays.js";

/**
 * What every member, agents included, may see of a feed (FR-025, US3 scenario 6): no link, no
 * fingerprint, no hint. The view filters itself to the request's workspace (migration 0017).
 */
export const calendarFeedPublic = pgView("calendar_feed_public", {
  id: uuid("id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  propertyId: uuid("property_id").notNull(),
  channel: text("channel", { enum: FEED_CHANNELS }).notNull(),
  channelLabel: text("channel_label"),
  status: text("status", { enum: FEED_STATUSES }).notNull(),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  failingSince: timestamp("failing_since", { withTimezone: true }),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}).existing();

/**
 * What every member, agents included, may see of a locked field (feature 003 FR-063, data model
 * §2): never the value or a public Wi-Fi password. The view filters itself to the request's
 * workspace (migration 0019).
 */
export const restrictedValuePublic = pgView("restricted_value_public", {
  id: uuid("id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  propertyId: uuid("property_id").notNull(),
  kind: text("kind", { enum: RESTRICTED_VALUE_KINDS }).notNull(),
  label: text("label").notNull(),
  sectionKind: text("section_kind", { enum: LOCKED_FIELD_SECTION_KINDS }).notNull(),
  source: text("source", { enum: RESTRICTED_VALUE_SOURCES }).notNull(),
  isSet: boolean("is_set").notNull(),
  isPublic: boolean("is_public").notNull(),
  valueSetAt: timestamp("value_set_at", { withTimezone: true }),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).existing();
