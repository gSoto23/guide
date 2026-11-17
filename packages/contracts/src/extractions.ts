import { z } from "zod";
import { listingContentKindSchema } from "./listing-content.js";

/** Contracts for listing extraction (feature 002 FR-009 to FR-019, data model §2). */
export const screenshotRequestSchema = z
  .object({
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    size: z
      .number()
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();

export const createExtractionSchema = z
  .object({
    text: z.string().max(20_000).optional(),
    screenshots: z.array(screenshotRequestSchema).max(10).default([]),
  })
  .strict()
  .refine((body) => Boolean(body.text?.trim()) || body.screenshots.length > 0, {
    message: "Paste the listing text or add screenshots",
    path: ["text"],
  });
export type CreateExtractionBody = z.infer<typeof createExtractionSchema>;

/** Counts per kind of removed value, for example `{door_code: 1}`. Never the values. */
export const redactionCountsSchema = z.record(z.string(), z.number().int());

export const uploadFormSchema = z.object({
  uploadId: z.uuid(),
  url: z.string(),
  fields: z.record(z.string(), z.string()),
});

export const extractionStatusSchema = z.enum([
  "awaiting_uploads",
  "queued",
  "running",
  "succeeded",
  "failed",
]);

export const createdExtractionSchema = z.object({
  extractionId: z.uuid(),
  status: extractionStatusSchema,
  urlOnly: z.boolean(),
  redactions: redactionCountsSchema,
  uploads: z.array(uploadFormSchema),
});
export type CreatedExtraction = z.infer<typeof createdExtractionSchema>;

export const extractedItemSchema = z.object({
  kind: listingContentKindSchema,
  body: z.string().nullable(),
  items: z.array(z.string()).nullable(),
  language: z.string().nullable(),
  /** A link the model kept as text, shown for review (AC-SEC-004). */
  containsLink: z.boolean(),
});
export type ExtractedItem = z.infer<typeof extractedItemSchema>;

export const extractionResultSchema = z.object({
  items: z.array(extractedItemSchema),
  proposedFacts: z.object({
    checkInTime: z.string().nullable(),
    checkoutTime: z.string().nullable(),
    maxGuests: z.number().int().nullable(),
  }),
  language: z.string().nullable(),
});
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const extractionSchema = z.object({
  id: z.uuid(),
  status: extractionStatusSchema,
  errorCode: z.string().nullable(),
  urlOnly: z.boolean(),
  redactions: redactionCountsSchema,
  screenshotCount: z.number().int(),
  failedScreenshots: z.number().int(),
  result: extractionResultSchema.nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type Extraction = z.infer<typeof extractionSchema>;
