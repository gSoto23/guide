/**
 * Tenancy tables (spec 001 data model §3, T036). RLS policies, the zero-owner guard, and helper
 * functions live in the custom migration that follows the generated one.
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const workspace = pgTable(
  "workspace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    status: text("status", { enum: ["active", "pending_deletion"] })
      .notNull()
      .default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("workspace_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check("workspace_status_valid", sql`${t.status} IN ('active', 'pending_deletion')`),
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
