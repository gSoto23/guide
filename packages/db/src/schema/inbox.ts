/**
 * The host inbox (feature 006 data model): copilot drafts, members' push subscriptions, and dismissed
 * trust suggestions. Presence lives with the conversations in `chat.ts`. RLS and grants are in
 * migration 0029.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { createdAt, inList } from "./columns.js";
import { property } from "./properties.js";
import { workspace } from "./tenancy.js";

export const BOOKING_STATUSES = ["inquiry", "confirmed"] as const;
export const COPILOT_RUN_STATUSES = ["pending", "done"] as const;
export const COPILOT_OUTCOMES = ["drafted", "limited", "unavailable", "failed"] as const;

export const copilotRun = pgTable(
  "copilot_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    bookingStatus: text("booking_status", { enum: BOOKING_STATUSES }).notNull(),
    language: text("language", { enum: ["es", "en"] })
      .notNull()
      .default("es"),
    status: text("status", { enum: COPILOT_RUN_STATUSES }).notNull().default("pending"),
    outcome: text("outcome", { enum: COPILOT_OUTCOMES }),
    draft: text("draft"),
    sectionIds: uuid("section_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    checks: jsonb("checks").$type<{ check: string; passed: boolean }[]>().notNull().default([]),
    removed: text("removed")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    caution: text("caution"),
    covered: boolean("covered"),
    topic: text("topic"),
    answerKind: text("answer_kind"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("copilot_run_property_idx").on(t.propertyId, t.createdAt),
    index("copilot_run_created_idx").on(t.createdAt),
    check("copilot_run_message_len", sql`char_length(${t.message}) BETWEEN 1 AND 4000`),
    check("copilot_run_booking_valid", inList(t.bookingStatus, BOOKING_STATUSES)),
    check("copilot_run_status_valid", inList(t.status, COPILOT_RUN_STATUSES)),
  ],
);

export const pushSubscription = pgTable(
  "push_subscription",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    device: text("device").notNull(),
    createdAt: createdAt(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("push_subscription_endpoint_uq").on(t.endpoint),
    index("push_subscription_user_idx").on(t.userId),
    check(
      "push_subscription_endpoint_https",
      sql`${t.endpoint} LIKE 'https://%' AND char_length(${t.endpoint}) <= 2048`,
    ),
    check("push_subscription_device_len", sql`char_length(${t.device}) BETWEEN 1 AND 60`),
  ],
);

export const assistantSuggestionDismissal = pgTable(
  "assistant_suggestion_dismissal",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    dismissedUntil: timestamp("dismissed_until", { withTimezone: true }).notNull(),
    dismissedBy: text("dismissed_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.topic] })],
);
