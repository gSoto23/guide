import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { extractionRequest, importItem, importRun, stay, upload, type Database } from "@guidesk/db";
import { JOB_QUEUES } from "@guidesk/domain";
import type { ObjectStoragePort } from "@guidesk/integrations";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * The daily retention job (feature 002 data model §6, T121). Each rule is one bounded update,
 * so a run that stops halfway is finished by the next one:
 *
 * - extraction input text and recognized text, 7 days after the request;
 * - guest names, 12 months after checkout (pending OQ-35);
 * - uploads past their 24-hour expiry, with their objects;
 * - CSV runs left waiting (validation or confirmation) for more than 7 days are cancelled;
 * - CSV row values, 7 days after the run finishes;
 * - any calendar link left on an item of a finished or cancelled run.
 *
 * It logs counts only, never values.
 */
export const RETENTION_CRON = "15 4 * * *";

const DAY_MS = 86_400_000;
/** Extraction input and CSV row values are kept 7 days (data model §6). */
const SHORT_RETENTION_DAYS = 7;
/** Guest names are kept 12 months after checkout (Confidential class; OQ-35). */
const GUEST_NAME_MONTHS = 12;
/** Expired uploads handled per run; the bucket's 1-day lifecycle rule is the backstop. */
const UPLOAD_BATCH = 500;

export interface RetentionDeps {
  db: Database;
  storage: ObjectStoragePort;
  now?: () => Date;
  span?: JobSpanDeps;
}

export interface RetentionCounts {
  extractionInputs: number;
  guestNames: number;
  uploads: number;
  cancelledRuns: number;
  rowValues: number;
  calendarLinks: number;
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** The calendar date `months` months before `now`, in UTC. */
function monthsBefore(now: Date, months: number): string {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

export async function runRetention(deps: RetentionDeps): Promise<RetentionCounts> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const weekAgo = daysBefore(now, SHORT_RETENTION_DAYS);

  const extractionInputs = await db
    .update(extractionRequest)
    .set({ inputText: null, recognizedText: null, inputDeletedAt: now })
    .where(
      and(
        isNull(extractionRequest.inputDeletedAt),
        lt(extractionRequest.createdAt, weekAgo),
        or(isNotNull(extractionRequest.inputText), isNotNull(extractionRequest.recognizedText)),
      ),
    )
    .returning({ id: extractionRequest.id });

  const guestNames = await db
    .update(stay)
    .set({ guestName: null })
    .where(
      and(isNotNull(stay.guestName), lt(stay.checkoutDate, monthsBefore(now, GUEST_NAME_MONTHS))),
    )
    .returning({ id: stay.id });

  // Objects first: a row marked deleted is never looked at again.
  const expired = await db
    .select({ id: upload.id, objectKey: upload.objectKey })
    .from(upload)
    .where(and(ne(upload.status, "deleted"), lt(upload.expiresAt, now)))
    .limit(UPLOAD_BATCH);
  for (const item of expired) {
    await deps.storage.delete(item.objectKey);
  }
  if (expired.length > 0) {
    await db
      .update(upload)
      .set({ status: "deleted", deletedAt: now })
      .where(
        inArray(
          upload.id,
          expired.map((item) => item.id),
        ),
      );
  }

  const cancelledRuns = await db
    .update(importRun)
    .set({ status: "cancelled", finishedAt: now })
    .where(
      and(
        eq(importRun.kind, "csv"),
        inArray(importRun.status, ["validating", "awaiting_confirmation"]),
        lt(importRun.createdAt, weekAgo),
      ),
    )
    .returning({ id: importRun.id });

  const rowValues = await db
    .update(importItem)
    .set({ rowValues: null })
    .where(
      and(
        isNotNull(importItem.rowValues),
        sql`${importItem.importRunId} IN (
          SELECT id FROM import_run WHERE finished_at IS NOT NULL AND finished_at < ${weekAgo}
        )`,
      ),
    )
    .returning({ id: importItem.id });

  // Saved or rejected links are cleared by csv.import, and cancelled runs by the API; this
  // catches anything a failed job left behind.
  const calendarLinks = await db
    .update(importItem)
    .set({ calendarUrlCiphertext: null, dataKeyId: null })
    .where(
      and(
        isNotNull(importItem.calendarUrlCiphertext),
        sql`${importItem.importRunId} IN (
          SELECT id FROM import_run WHERE status IN ('completed', 'failed', 'cancelled')
        )`,
      ),
    )
    .returning({ id: importItem.id });

  return {
    extractionInputs: extractionInputs.length,
    guestNames: guestNames.length,
    uploads: expired.length,
    cancelledRuns: cancelledRuns.length,
    rowValues: rowValues.length,
    calendarLinks: calendarLinks.length,
  };
}

/** The pg-boss handler for the daily schedule: one span with the counts (constitution VIII). */
export function createRetentionHandler(deps: RetentionDeps) {
  return async (): Promise<void> => {
    await runInJobSpan(
      { queue: JOB_QUEUES.retentionDaily },
      async (span) => {
        const counts = await runRetention(deps);
        span.set({
          "job.outcome": "completed",
          "retention.extraction_inputs": counts.extractionInputs,
          "retention.guest_names": counts.guestNames,
          "retention.uploads": counts.uploads,
          "retention.cancelled_runs": counts.cancelledRuns,
          "retention.row_values": counts.rowValues,
          "retention.calendar_links": counts.calendarLinks,
        });
      },
      deps.span,
    );
  };
}
