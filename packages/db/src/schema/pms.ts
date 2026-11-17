/**
 * PMS connections (feature 002 data model §4, research R7). The credential is restricted data,
 * set to null at disconnect whether or not the provider revoked it (FR-036).
 */
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { bytea, inList } from "./columns.js";
import { workspaceDataKey } from "./keys.js";
import { PMS_PROVIDERS } from "./properties.js";
import { workspace } from "./tenancy.js";

export const PMS_CONNECTION_STATUSES = ["active", "failing", "disconnected"] as const;

export const pmsConnection = pgTable(
  "pms_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: PMS_PROVIDERS }).notNull(),
    /** Provider account identifier (not secret). */
    externalAccountId: text("external_account_id").notNull(),
    accountLabel: text("account_label").notNull(),
    /** Restricted (SEC-06). For Beds24 the refresh token, never the invite code. */
    credentialCiphertext: bytea("credential_ciphertext"),
    dataKeyId: uuid("data_key_id").references(() => workspaceDataKey.id),
    status: text("status", { enum: PMS_CONNECTION_STATUSES }).notNull().default("active"),
    lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
    failingSince: timestamp("failing_since", { withTimezone: true }),
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    manualRefreshAt: timestamp("manual_refresh_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    connectedBy: text("connected_by").references(() => user.id, { onDelete: "set null" }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    disconnectedBy: text("disconnected_by").references(() => user.id, { onDelete: "set null" }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("pms_connection_account_uq")
      .on(t.workspaceId, t.provider, t.externalAccountId)
      .where(sql`${t.status} <> 'disconnected'`),
    index("pms_connection_due_idx").on(t.lastRefreshAt),
    check("pms_connection_provider_valid", inList(t.provider, PMS_PROVIDERS)),
    check("pms_connection_status_valid", inList(t.status, PMS_CONNECTION_STATUSES)),
    check(
      "pms_connection_label_length",
      sql`char_length(${t.accountLabel}) BETWEEN 1 AND 80 AND char_length(${t.externalAccountId}) BETWEEN 1 AND 120`,
    ),
    // A connection holds a credential exactly while it is not disconnected (FR-036).
    check(
      "pms_connection_credential_state",
      sql`(${t.status} = 'disconnected' AND ${t.credentialCiphertext} IS NULL AND ${t.disconnectedAt} IS NOT NULL)
        OR (${t.status} <> 'disconnected' AND ${t.credentialCiphertext} IS NOT NULL AND ${t.dataKeyId} IS NOT NULL)`,
    ),
    check(
      "pms_connection_error_code_length",
      sql`${t.lastErrorCode} IS NULL OR char_length(${t.lastErrorCode}) <= 40`,
    ),
  ],
);
