/**
 * Import runs and their items, shared by PMS and CSV imports (feature 002 data model §4). CSV
 * row values never include the calendar link, which is kept encrypted until the feed is saved.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { bytea, createdAt, inList } from "./columns.js";
import { upload } from "./extractions.js";
import { workspaceDataKey } from "./keys.js";
import { pmsConnection } from "./pms.js";
import { property } from "./properties.js";
import { workspace } from "./tenancy.js";

export const IMPORT_KINDS = ["pms", "csv"] as const;
export const IMPORT_RUN_STATUSES = [
  "validating",
  "awaiting_confirmation",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const importRun = pgTable(
  "import_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: IMPORT_KINDS }).notNull(),
    pmsConnectionId: uuid("pms_connection_id").references((): AnyPgColumn => pmsConnection.id, {
      onDelete: "set null",
    }),
    uploadId: uuid("upload_id").references((): AnyPgColumn => upload.id, { onDelete: "set null" }),
    status: text("status", { enum: IMPORT_RUN_STATUSES }).notNull(),
    total: integer("total").notNull().default(0),
    processed: integer("processed").notNull().default(0),
    created: integer("created").notNull().default(0),
    needsDetails: integer("needs_details").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    startedBy: text("started_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (t) => [
    index("import_run_workspace_idx").on(t.workspaceId, t.status, t.createdAt),
    check("import_run_kind_valid", inList(t.kind, IMPORT_KINDS)),
    check("import_run_status_valid", inList(t.status, IMPORT_RUN_STATUSES)),
    check(
      "import_run_counts",
      sql`${t.total} >= 0 AND ${t.processed} BETWEEN 0 AND ${t.total}
        AND ${t.created} >= 0 AND ${t.needsDetails} >= 0 AND ${t.failed} >= 0 AND ${t.skipped} >= 0`,
    ),
  ],
);

export const IMPORT_ITEM_OUTCOMES = [
  "pending",
  "created",
  "updated",
  "needs_details",
  "failed",
  "skipped",
] as const;

export const importItem = pgTable(
  "import_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRun.id, { onDelete: "cascade" }),
    /** CSV row (header = row 1). */
    rowNumber: integer("row_number"),
    /** PMS listing ID. */
    externalId: text("external_id"),
    label: text("label").notNull(),
    selected: boolean("selected").notNull().default(true),
    outcome: text("outcome", { enum: IMPORT_ITEM_OUTCOMES }).notNull().default("pending"),
    reasonCode: text("reason_code"),
    /** CSV: `[{column, code}]`. */
    errors: jsonb("errors").$type<{ column: string; code: string }[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<{ column?: string; code: string }[]>().notNull().default([]),
    /** Validated CSV values without the calendar link; set to null 7 days after the run. */
    rowValues: jsonb("row_values").$type<Record<string, string>>(),
    /** The CSV calendar link, encrypted at validation; set to null once read or cancelled. */
    calendarUrlCiphertext: bytea("calendar_url_ciphertext"),
    dataKeyId: uuid("data_key_id").references(() => workspaceDataKey.id),
    propertyId: uuid("property_id").references((): AnyPgColumn => property.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("import_item_run_idx").on(t.importRunId, t.rowNumber),
    index("import_item_workspace_idx").on(t.workspaceId),
    check("import_item_outcome_valid", inList(t.outcome, IMPORT_ITEM_OUTCOMES)),
    check("import_item_label_length", sql`char_length(${t.label}) BETWEEN 1 AND 120`),
    check(
      "import_item_reason_length",
      sql`${t.reasonCode} IS NULL OR char_length(${t.reasonCode}) <= 40`,
    ),
    check(
      "import_item_calendar_key",
      sql`${t.calendarUrlCiphertext} IS NULL OR ${t.dataKeyId} IS NOT NULL`,
    ),
  ],
);
