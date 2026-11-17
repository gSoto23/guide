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

export const importItemSchema = z.object({
  id: z.uuid(),
  externalId: z.string().nullable(),
  rowNumber: z.number().int().nullable(),
  label: z.string(),
  outcome: importItemOutcomeSchema,
  /** For example `plan_limit`, `provider_error`, `reconnect_pms`, `invalid_time_zone`. */
  reasonCode: z.string().nullable(),
  propertyId: z.uuid().nullable(),
});
export type ImportItem = z.infer<typeof importItemSchema>;

export const importItemListSchema = z.object({ items: z.array(importItemSchema) });
export type ImportItemList = z.infer<typeof importItemListSchema>;

export const listImportItemsQuerySchema = z
  .object({ outcome: importItemOutcomeSchema.optional() })
  .strict();
