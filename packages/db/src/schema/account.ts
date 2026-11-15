/** User-scoped account tables (spec 001 data model §2, T037). */
import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const onboardingProfile = pgTable(
  "onboarding_profile",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    propertiesBucket: text("properties_bucket", { enum: ["1_2", "3_10", "10_plus"] }),
    pms: text("pms"),
    pmsOther: text("pms_other"),
    country: text("country"),
    path: text("path", { enum: ["individual", "manager"] })
      .notNull()
      .default("individual"),
    skipped: boolean("skipped").notNull().default(false),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "onboarding_bucket_valid",
      sql`${t.propertiesBucket} IS NULL OR ${t.propertiesBucket} IN ('1_2', '3_10', '10_plus')`,
    ),
    check(
      "onboarding_pms_valid",
      sql`${t.pms} IS NULL OR ${t.pms} IN ('hostaway', 'guesty', 'hospitable', 'smoobu', 'ownerrez', 'hostfully', 'beds24', 'hostex', 'lodgify', 'uplisting', 'stays_net', 'other', 'none')`,
    ),
    check(
      "onboarding_pms_other_valid",
      sql`(${t.pmsOther} IS NULL OR (${t.pms} = 'other' AND char_length(${t.pmsOther}) <= 80))`,
    ),
    check("onboarding_country_valid", sql`${t.country} IS NULL OR ${t.country} ~ '^[A-Z]{2}$'`),
    check("onboarding_path_valid", sql`${t.path} IN ('individual', 'manager')`),
  ],
);

/**
 * Account deletion requests (FR-028, data model §2). No foreign key: the row outlives the purged
 * account as the record that the deletion was completed. System context only.
 */
export const accountDeletionRequest = pgTable(
  "account_deletion_request",
  {
    userId: text("user_id").primaryKey(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    purgeAfter: timestamp("purge_after", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["scheduled", "completed", "cancelled"] })
      .notNull()
      .default("scheduled"),
  },
  (t) => [
    check(
      "account_deletion_status_valid",
      sql`${t.status} IN ('scheduled', 'completed', 'cancelled')`,
    ),
  ],
);

/**
 * A pending email change (FR-029): the new address must prove itself with a one-time code, kept
 * only as an HMAC. One per user; a new request replaces it. System context only.
 */
export const emailChangeRequest = pgTable("email_change_request", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  newEmail: text("new_email").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
