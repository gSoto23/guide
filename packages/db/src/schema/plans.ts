/**
 * Feature 011 (data model): one row per workspace, month, and AI usage threshold whose owners were
 * emailed, so each email goes once. System only: the worker reads and writes it.
 *
 * Feature 019 (data model): AI reply top-ups the founder adds to a workspace. Replies are taken
 * after the month's allowance, oldest first, until the top-up expires 12 months after it was added.
 * Members may read their workspace's top-ups (the plan screen); only system code writes them.
 */
import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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

/** The most AI replies one top-up may hold (feature 019 FR-005). */
export const TOP_UP_MAX_REPLIES = 100_000;

export const aiTopUp = pgTable(
  "ai_top_up",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    repliesGranted: integer("replies_granted").notNull(),
    repliesUsed: integer("replies_used").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** 12 months after `created_at` (FR-007). */
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '12 months'`),
    note: text("note").notNull(),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    correctionNote: text("correction_note"),
    /** When the "top-up used up" email was claimed (FR-013). */
    exhaustedNotifiedAt: timestamp("exhausted_notified_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_top_up_workspace_idx").on(t.workspaceId, t.createdAt),
    index("ai_top_up_open_idx")
      .on(t.workspaceId, t.createdAt)
      .where(sql`${t.repliesUsed} < ${t.repliesGranted}`),
    check(
      "ai_top_up_granted_range",
      sql`${t.repliesGranted} BETWEEN 0 AND ${sql.raw(String(TOP_UP_MAX_REPLIES))}`,
    ),
    check(
      "ai_top_up_used_range",
      sql`${t.repliesUsed} >= 0 AND ${t.repliesUsed} <= ${t.repliesGranted}`,
    ),
    check("ai_top_up_note_length", sql`char_length(${t.note}) BETWEEN 1 AND 200`),
    check(
      "ai_top_up_correction_note_length",
      sql`${t.correctionNote} IS NULL OR char_length(${t.correctionNote}) BETWEEN 1 AND 200`,
    ),
  ],
);
