import { z } from "zod";
import { pmsProviderSchema } from "./properties.js";

/** Contracts for import runs, shared by PMS and CSV imports (feature 002 FR-028 to FR-042). */
export const importRunStatusSchema = z.enum([
  "validating",
  "awaiting_confirmation",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const importRunSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["pms", "csv"]),
  provider: pmsProviderSchema.nullable(),
  status: importRunStatusSchema,
  total: z.number().int(),
  processed: z.number().int(),
  created: z.number().int(),
  needsDetails: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  /**
   * Why a CSV file could not be read: `too_large`, `too_many_rows`, `unsupported_type`,
   * `unreadable`, `not_found`, `missing_name_column`, `duplicate_column`, or `no_rows`.
   */
  errorCode: z.string().nullable(),
});
export type ImportRun = z.infer<typeof importRunSchema>;

export const importRunListSchema = z.object({ items: z.array(importRunSchema) });
export type ImportRunList = z.infer<typeof importRunListSchema>;

export const listImportRunsQuerySchema = z
  .object({ status: importRunStatusSchema.optional() })
  .strict();

export const importItemOutcomeSchema = z.enum([
  "pending",
  "created",
  "updated",
  "needs_details",
  "failed",
  "skipped",
]);

/** A CSV error or warning: the column, the code, and for a duplicate row the row it repeats. */
export const csvIssueSchema = z.object({
  column: z.string().optional(),
  code: z.string(),
  row: z.number().int().optional(),
});
export type CsvIssueBody = z.infer<typeof csvIssueSchema>;

export const importItemSchema = z.object({
  id: z.uuid(),
  externalId: z.string().nullable(),
  rowNumber: z.number().int().nullable(),
  label: z.string(),
  /** PMS: chosen to import. CSV: a row that can be created, or the row chosen within the limit. */
  selected: z.boolean(),
  outcome: importItemOutcomeSchema,
  /** For example `plan_limit`, `provider_error`, `reconnect_pms`, `invalid_row`, `not_selected`. */
  reasonCode: z.string().nullable(),
  propertyId: z.uuid().nullable(),
  /** CSV: errors by column (FR-039), localized when shown. Empty for PMS listings. */
  errors: z.array(csvIssueSchema),
  /** CSV: missing facts, duplicate rows, and matches with existing properties (FR-040). */
  warnings: z.array(csvIssueSchema),
});
export type ImportItem = z.infer<typeof importItemSchema>;

export const importItemListSchema = z.object({ items: z.array(importItemSchema) });
export type ImportItemList = z.infer<typeof importItemListSchema>;

export const listImportItemsQuerySchema = z
  .object({ outcome: importItemOutcomeSchema.optional() })
  .strict();

// --- CSV (US5, FR-037 to FR-042) ---

export const csvLanguageSchema = z.enum(["es", "en"]);

/** `GET /imports/csv-template?lang=` and `GET /imports/{id}/error-file?lang=`. */
export const csvLanguageQuerySchema = z.object({ lang: csvLanguageSchema.default("es") }).strict();

/** `POST /imports/csv`: the file the browser is about to upload, up to 2 MB (FR-038). */
export const createCsvImportSchema = z
  .object({
    contentType: z.string().trim().min(1).max(100),
    size: z
      .number()
      .int()
      .min(1)
      .max(2 * 1024 * 1024),
  })
  .strict();
export type CreateCsvImportBody = z.infer<typeof createCsvImportSchema>;

export const createdCsvImportSchema = z.object({
  importRunId: z.uuid(),
  upload: z.object({
    uploadId: z.uuid(),
    url: z.string(),
    fields: z.record(z.string(), z.string()),
  }),
});
export type CreatedCsvImport = z.infer<typeof createdCsvImportSchema>;

/**
 * `POST /imports/{id}/confirm`: the rows to create. Required when the rows that can be created
 * are more than the free slots (US5 scenario 5); otherwise every such row is created.
 */
export const confirmCsvImportSchema = z
  .object({ rowNumbers: z.array(z.number().int().min(1)).min(1).max(500).optional() })
  .strict();
export type ConfirmCsvImportBody = z.infer<typeof confirmCsvImportSchema>;
