/**
 * Views created by custom migrations. They live outside src/schema so drizzle-kit, which only
 * generates tables, never tries to create them.
 */
import { pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
