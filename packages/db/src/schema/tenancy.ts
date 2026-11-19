/**
 * Tenancy tables (spec 001 data model §3, T036). RLS policies, the zero-owner guard, and helper
 * functions live in the custom migration that follows the generated one.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { inList } from "./columns.js";

/** The plans of feature 011 (kept in step with `PLANS` in @guidesk/domain by a test). */
export const PLAN_VALUES = ["free", "pro", "business"] as const;

export const workspace = pgTable(
  "workspace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Kept for history; cleared when that account is purged (FR-028), never blocking it.
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    status: text("status", { enum: ["active", "pending_deletion"] })
      .notNull()
      .default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    /** Feature 011: Free, Pro, or Business (data model); only the founder tool changes it. */
    plan: text("plan", { enum: PLAN_VALUES }).notNull().default("free"),
    planChangedAt: timestamp("plan_changed_at", { withTimezone: true }),
    /** The founder's last note about the plan; never returned by the API. */
    planNote: text("plan_note"),
    /** Custom limits set by Guidesk (feature 011 FR-003); null uses the plan's value. */
    seatLimit: integer("seat_limit"),
    propertyLimit: integer("property_limit"),
    aiReplyMonthlyLimit: integer("ai_reply_monthly_limit"),
    /** Feature 013: a custom platform fee in basis points; null uses the plan's. */
    platformFeeBps: integer("platform_fee_bps"),
    /** Feature 003 pilot overrides (data model §5): daily guide AI requests and media storage. */
    guideAiDailyLimit: integer("guide_ai_daily_limit"),
    mediaStorageLimitMb: integer("media_storage_limit_mb"),
    /** Feature 005 pilot budgets (FR-028): assistant replies and drafts per day. */
    chatDailyLimit: integer("chat_daily_limit").notNull().default(1000),
    chatPropertyDailyLimit: integer("chat_property_daily_limit").notNull().default(200),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("workspace_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check("workspace_status_valid", sql`${t.status} IN ('active', 'pending_deletion')`),
    check("workspace_plan_valid", inList(t.plan, PLAN_VALUES)),
    check(
      "workspace_plan_note_length",
      sql`${t.planNote} IS NULL OR char_length(${t.planNote}) BETWEEN 1 AND 200`,
    ),
    check(
      "workspace_ai_reply_monthly_limit_positive",
      sql`${t.aiReplyMonthlyLimit} IS NULL OR ${t.aiReplyMonthlyLimit} > 0`,
    ),
    check(
      "workspace_platform_fee_bps_range",
      sql`${t.platformFeeBps} IS NULL OR ${t.platformFeeBps} BETWEEN 0 AND 3000`,
    ),
    check("workspace_seat_limit_positive", sql`${t.seatLimit} IS NULL OR ${t.seatLimit} > 0`),
    check(
      "workspace_property_limit_positive",
      sql`${t.propertyLimit} IS NULL OR ${t.propertyLimit} > 0`,
    ),
    check(
      "workspace_guide_ai_daily_limit_positive",
      sql`${t.guideAiDailyLimit} IS NULL OR ${t.guideAiDailyLimit} > 0`,
    ),
    check(
      "workspace_media_storage_limit_positive",
      sql`${t.mediaStorageLimitMb} IS NULL OR ${t.mediaStorageLimitMb} > 0`,
    ),
    index("workspace_created_by_idx").on(t.createdBy),
  ],
);

export const membership = pgTable(
  "membership",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "agent"] }).notNull(),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("membership_workspace_user_uq").on(t.workspaceId, t.userId),
    // Exactly one owner per workspace (FR-016); a deferred trigger prevents zero owners.
    uniqueIndex("membership_one_owner_uq")
      .on(t.workspaceId)
      .where(sql`${t.role} = 'owner'`),
    index("membership_user_idx").on(t.userId),
    check("membership_role_valid", sql`${t.role} IN ('owner', 'admin', 'agent')`),
  ],
);

/**
 * Invitations (US3, data model §3). The token appears only in the email link; only its SHA-256
 * hash is stored. Acceptance goes through the accept_invitation() function (research R4).
 */
export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "agent"] }).notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status", { enum: ["pending", "accepted", "revoked", "expired"] })
      .notNull()
      .default("pending"),
    invitedBy: text("invited_by").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    sendCount: integer("send_count").notNull().default(1),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invitation_token_hash_uq").on(t.tokenHash),
    // One open invitation per workspace and email (data model §3).
    uniqueIndex("invitation_pending_email_uq")
      .on(t.workspaceId, t.email)
      .where(sql`${t.status} = 'pending'`),
    index("invitation_workspace_idx").on(t.workspaceId, t.createdAt),
    check("invitation_role_valid", sql`${t.role} IN ('admin', 'agent')`),
    check(
      "invitation_status_valid",
      sql`${t.status} IN ('pending', 'accepted', 'revoked', 'expired')`,
    ),
    check("invitation_email_normalized", sql`${t.email} = lower(btrim(${t.email}))`),
  ],
);
