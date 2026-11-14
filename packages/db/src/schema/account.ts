/** User-scoped account tables (spec 001 data model §2, T037). */
import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";
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
