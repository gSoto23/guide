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
    /** Pilot seat limit set by Guidesk (FR-021); null uses the default. Feature 011 replaces it. */
    seatLimit: integer("seat_limit"),
    /** Pilot property limit set by Guidesk (FR-047); null uses the Free plan's 2. */
    propertyLimit: integer("property_limit"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("workspace_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check("workspace_status_valid", sql`${t.status} IN ('active', 'pending_deletion')`),
    check("workspace_seat_limit_positive", sql`${t.seatLimit} IS NULL OR ${t.seatLimit} > 0`),
    check(
      "workspace_property_limit_positive",
      sql`${t.propertyLimit} IS NULL OR ${t.propertyLimit} > 0`,
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
