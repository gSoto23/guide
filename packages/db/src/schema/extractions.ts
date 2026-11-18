/**
 * Uploads and listing extraction requests (feature 002 data model §2). Text is stored only after
 * redaction (FR-012) and deleted on confirmation or after 7 days.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { createdAt, inList } from "./columns.js";
import { guideDocument, interviewTurn, mediaObject } from "./guides.js";
import { importRun } from "./imports.js";
import { property } from "./properties.js";
import { workspace } from "./tenancy.js";

export const UPLOAD_PURPOSES = [
  "screenshot",
  "csv",
  "document",
  "photo",
  "media",
  "voice",
] as const;
export const UPLOAD_STATUSES = ["pending", "received", "processed", "rejected", "deleted"] as const;

export const upload = pgTable(
  "upload",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: UPLOAD_PURPOSES }).notNull(),
    /** `uploads/{workspace_id}/{upload_id}`; never derived from the file name. */
    objectKey: text("object_key").notNull(),
    /** From the client; verified again by content in the sandbox (SEC-10). */
    declaredType: text("declared_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    status: text("status", { enum: UPLOAD_STATUSES }).notNull().default("pending"),
    rejectReason: text("reject_reason"),
    extractionRequestId: uuid("extraction_request_id").references(
      (): AnyPgColumn => extractionRequest.id,
      { onDelete: "set null" },
    ),
    importRunId: uuid("import_run_id").references((): AnyPgColumn => importRun.id, {
      onDelete: "set null",
    }),
    /** Feature 003 owners (data model §5). */
    mediaObjectId: uuid("media_object_id").references((): AnyPgColumn => mediaObject.id, {
      onDelete: "set null",
    }),
    guideDocumentId: uuid("guide_document_id").references((): AnyPgColumn => guideDocument.id, {
      onDelete: "set null",
    }),
    interviewTurnId: uuid("interview_turn_id").references((): AnyPgColumn => interviewTurn.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("upload_object_key_uq").on(t.objectKey),
    index("upload_workspace_idx").on(t.workspaceId),
    index("upload_expires_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} <> 'deleted'`),
    index("upload_extraction_idx").on(t.extractionRequestId),
    check("upload_purpose_valid", inList(t.purpose, UPLOAD_PURPOSES)),
    check("upload_status_valid", inList(t.status, UPLOAD_STATUSES)),
    // 10 MB for images and voice notes, 2 MB for CSV (checked by the API), 20 MB for documents,
    // and 150 MB for media, where videos are (feature 003 FR-009, FR-039).
    check(
      "upload_declared_size_range",
      sql`${t.declaredSize} > 0 AND ${t.declaredSize} <= CASE ${t.purpose} WHEN 'media' THEN 157286400 WHEN 'document' THEN 20971520 ELSE 10485760 END`,
    ),
    check("upload_declared_type_length", sql`char_length(${t.declaredType}) BETWEEN 1 AND 100`),
  ],
);

export const EXTRACTION_STATUSES = [
  "awaiting_uploads",
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;

export const extractionRequest = pgTable(
  "extraction_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Set when the host confirms the property. */
    propertyId: uuid("property_id").references((): AnyPgColumn => property.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: EXTRACTION_STATUSES }).notNull(),
    /** Pasted text after redaction (FR-012). */
    inputText: text("input_text"),
    /** Text recognized from screenshots, after redaction. */
    recognizedText: text("recognized_text"),
    screenshotCount: smallint("screenshot_count").notNull().default(0),
    /** Counts per kind, for example `{"door_code": 1}`. Never the values. */
    redactions: jsonb("redactions").$type<Record<string, number>>().notNull().default({}),
    urlOnly: boolean("url_only").notNull().default(false),
    retryOfId: uuid("retry_of_id").references((): AnyPgColumn => extractionRequest.id, {
      onDelete: "set null",
    }),
    result: jsonb("result"),
    failedScreenshots: smallint("failed_screenshots").notNull().default(0),
    errorCode: text("error_code"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsdMicros: integer("cost_usd_micros"),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    inputDeletedAt: timestamp("input_deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("extraction_request_workspace_idx").on(t.workspaceId, t.createdAt),
    index("extraction_request_retention_idx")
      .on(t.createdAt)
      .where(sql`${t.inputDeletedAt} IS NULL`),
    check("extraction_request_status_valid", inList(t.status, EXTRACTION_STATUSES)),
    check(
      "extraction_request_input_length",
      sql`${t.inputText} IS NULL OR char_length(${t.inputText}) <= 20000`,
    ),
    check(
      "extraction_request_screenshot_count_range",
      sql`${t.screenshotCount} BETWEEN 0 AND 10 AND ${t.failedScreenshots} BETWEEN 0 AND ${t.screenshotCount}`,
    ),
    check(
      "extraction_request_error_code_length",
      sql`${t.errorCode} IS NULL OR char_length(${t.errorCode}) <= 40`,
    ),
  ],
);
