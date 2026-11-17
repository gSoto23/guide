/**
 * Per-workspace data keys for restricted data (feature 002 data model §1, research R5). Only the
 * wrapped copy is stored; KMS unwraps it with the encryption context `{workspace_id}`.
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea, createdAt, inList } from "./columns.js";
import { workspace } from "./tenancy.js";

export const DATA_KEY_STATUSES = ["active", "retired"] as const;

export const workspaceDataKey = pgTable(
  "workspace_data_key",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    wrappedKey: bytea("wrapped_key").notNull(),
    /** The KMS key ARN that wrapped it, or `local` in development. */
    kmsKeyId: text("kms_key_id").notNull(),
    status: text("status", { enum: DATA_KEY_STATUSES }).notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    // One active key per workspace; yearly rotation retires the old one, which still decrypts.
    uniqueIndex("workspace_data_key_one_active_uq")
      .on(t.workspaceId)
      .where(sql`${t.status} = 'active'`),
    index("workspace_data_key_workspace_idx").on(t.workspaceId),
    check("workspace_data_key_status_valid", inList(t.status, DATA_KEY_STATUSES)),
  ],
);
