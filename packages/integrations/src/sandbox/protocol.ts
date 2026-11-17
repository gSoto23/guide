import { z } from "zod";

/**
 * Wire protocol of the sandbox functions (research R2, SEC-09, SEC-10): the requests the API and
 * the worker send to `feed-reader` and `file-processor`, and the responses they return. The same
 * schemas validate both sides, so `apps/sandbox` imports this module on its own through the
 * `@guidesk/integrations/sandbox-protocol` entry, which carries no provider SDK. Keep it Zod only.
 *
 * Feed links, recognized text, and CSV rows are restricted or confidential. Nothing here logs,
 * and every object is strict: an unexpected field (a feed summary, say) fails validation instead
 * of crossing the boundary.
 */

/** At most this many entries per feed read (R8). */
export const FEED_MAX_ENTRIES = 5000;
/** At most this many characters of recognized text per screenshot (R3). */
export const FILE_MAX_TEXT_LENGTH = 200_000;
/** At most this many CSV rows, the header included: 500 data rows (R10). */
export const FILE_MAX_ROWS = 501;

/** Longest calendar link the sandbox accepts. */
const MAX_URL_LENGTH = 2048;
/** Longest `ETag` or `Last-Modified` value kept for conditional requests (data model §3). */
const MAX_HEADER_LENGTH = 1024;

const headerValueSchema = z.string().min(1).max(MAX_HEADER_LENGTH);

/** A calendar date, `YYYY-MM-DD`, with no time or zone. */
const calendarDateSchema = z.iso.date();

// --- feed-reader ---

/** Reads one iCal link. `etag` and `lastModified` make the request conditional (R8). */
export const feedReadRequestSchema = z.strictObject({
  url: z.url({ protocol: /^https$/ }).max(MAX_URL_LENGTH),
  etag: headerValueSchema.optional(),
  lastModified: headerValueSchema.optional(),
});
export type FeedReadRequest = z.infer<typeof feedReadRequestSchema>;

/**
 * One feed entry: the iCal `UID`, the dates, and the class from the domain table (FR-022).
 * Summaries, descriptions, reservation links, and phone digits never leave the function.
 */
export const feedEntrySchema = z.strictObject({
  uid: z.string().min(1).max(255),
  start: calendarDateSchema,
  end: calendarDateSchema,
  kind: z.enum(["reservation", "block", "unlabeled"]),
});
export type FeedEntry = z.infer<typeof feedEntrySchema>;

const HTTP_ERROR_CODE = /^http_[1-5]\d\d$/;

/** An unexpected HTTP status from the feed's host, for example `http_404`. */
export type FeedHttpErrorCode = `http_${number}`;

const feedHttpErrorCodeSchema = z
  .templateLiteral(["http_", z.int()])
  .refine((code) => HTTP_ERROR_CODE.test(code));

export const FEED_ERROR_CODES = [
  "not_https",
  "blocked_address",
  "dns_failed",
  "too_many_redirects",
  "too_large",
  "timeout",
  "connection_failed",
  "not_ical",
  "internal",
] as const;

/** Why a feed read failed; stored as `calendar_feed.last_error_code` (data model §3). */
export const feedErrorCodeSchema = z.union([z.enum(FEED_ERROR_CODES), feedHttpErrorCodeSchema]);
export type FeedErrorCode = z.infer<typeof feedErrorCodeSchema>;

/** A `304 Not Modified` answer: the caller keeps the stays it has (R8). */
export const feedNotModifiedSchema = z.strictObject({
  notModified: z.literal(true),
  etag: headerValueSchema.nullable(),
  lastModified: headerValueSchema.nullable(),
});

export const feedEntriesSchema = z.strictObject({
  entries: z.array(feedEntrySchema).max(FEED_MAX_ENTRIES),
  etag: headerValueSchema.nullable(),
  lastModified: headerValueSchema.nullable(),
});

export const feedErrorSchema = z.strictObject({ error: feedErrorCodeSchema });

export const feedReadResponseSchema = z.union([
  feedEntriesSchema,
  feedNotModifiedSchema,
  feedErrorSchema,
]);
export type FeedReadResponse = z.infer<typeof feedReadResponseSchema>;

// --- file-processor ---

/** The key of an uploaded object: `uploads/{workspace_id}/{upload_id}` (data model §2). */
export const UPLOAD_OBJECT_KEY = /^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

/** Processes one uploaded object: text recognition for a screenshot, parsing for a CSV file. */
export const fileProcessRequestSchema = z.strictObject({
  objectKey: z.string().regex(UPLOAD_OBJECT_KEY),
  purpose: z.enum(["screenshot", "csv"]),
});
export type FileProcessRequest = z.infer<typeof fileProcessRequestSchema>;

export const FILE_ERROR_CODES = [
  "unsupported_type",
  "too_large",
  "unreadable",
  "too_many_rows",
  "not_found",
  "internal",
] as const;

/** Why a file was not processed; stored as `upload.reject_reason` (data model §2). */
export const fileErrorCodeSchema = z.enum(FILE_ERROR_CODES);
export type FileErrorCode = z.infer<typeof fileErrorCodeSchema>;

/** Recognized text of a screenshot (R3). */
export const fileTextSchema = z.strictObject({
  text: z.string().max(FILE_MAX_TEXT_LENGTH),
});

/** Cells of a CSV file; the first row is the header (R10). */
export const fileRowsSchema = z.strictObject({
  rows: z.array(z.array(z.string())).max(FILE_MAX_ROWS),
});

export const fileErrorSchema = z.strictObject({ error: fileErrorCodeSchema });

export const fileProcessResponseSchema = z.union([fileTextSchema, fileRowsSchema, fileErrorSchema]);
export type FileProcessResponse = z.infer<typeof fileProcessResponseSchema>;
