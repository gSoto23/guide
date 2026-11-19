/**
 * Feature 011 (data model): one row per workspace, month, and AI usage threshold whose owners were
 * emailed, so each email goes once. System only: the worker reads and writes it.
 */
import { sql } from "drizzle-orm";
import { check, date, pgTable, primaryKey, smallint, timestamp, uuid } from "drizzle-orm/pg-core";
import { workspace } from "./tenancy.js";

export const planUsageNotice = pgTable(
  "plan_usage_notice",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** The first UTC day of the month. */
    month: date("month").notNull(),
    threshold: smallint("threshold").notNull(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.month, t.threshold] }),
    check("plan_usage_notice_threshold_valid", sql`${t.threshold} IN (80, 100)`),
  ],
);
