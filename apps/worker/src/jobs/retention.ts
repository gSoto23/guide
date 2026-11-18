import { and, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import {
  chatUsageDaily,
  extractionRequest,
  guideAiRequest,
  guideDocument,
  guideLink,
  importItem,
  importRun,
  interviewTurn,
  mediaObject,
  stay,
  upload,
  type Database,
} from "@guidesk/db";
import { JOB_QUEUES } from "@guidesk/domain";
import type { MediaStoragePort, ObjectStoragePort } from "@guidesk/integrations";
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
 * - any calendar link left on an item of a finished or cancelled run;
 * - feature 003: interview answers and transcripts, and text read from documents, 7 days after
 *   they were written; published versions beyond the latest 20 per guide, never the current one;
 *   media no item, block, or kept version uses, 24 hours after it became unused; and AI request
 *   rows after 12 months (data model §6).
 * - feature 005: conversations 12 months after the stay's checkout (or the last message without a
 *   stay), and daily chat usage after 13 months.
 * - feature 007: "test the assistant" runs (with their traces) after 30 days, and instruction
 *   versions that are neither current nor referenced by a trace.
 * - feature 006: copilot drafts (with their traces) after 30 days, and expired presence rows.
 * - feature 008: add-on requests (with the guest's note) 12 months after their stay's checkout.
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
/** Published versions kept per guide (feature 003 FR-055). */
const KEPT_VERSIONS = 20;
/** AI usage rows are kept 12 months (feature 003 data model §6). */
const AI_REQUEST_MONTHS = 12;
/** Unused media handled per run. */
const MEDIA_BATCH = 200;
/** Feature 005: conversations are kept 12 months, daily chat usage 13 months (data model §5). */
const CONVERSATION_MONTHS = 12;
const CHAT_USAGE_MONTHS = 13;
const CONVERSATION_BATCH = 1000;
/** Feature 007 research R12, R13: tests are kept 30 days; old instruction versions while traced. */
const ASSISTANT_TEST_DAYS = 30;
const INSTRUCTION_BATCH = 1000;
/** Feature 006 (data model): copilot drafts are kept 30 days; presence an hour past its expiry. */
const COPILOT_RUN_DAYS = 30;
const PRESENCE_GRACE_MS = 3_600_000;
/** Feature 008 research R9: requests are kept 12 months after their stay's checkout, like chats. */
const SERVICE_REQUEST_MONTHS = 12;
const SERVICE_REQUEST_BATCH = 1000;

export interface RetentionDeps {
  db: Database;
  storage: ObjectStoragePort;
  /** Feature 003: the media bucket, for unused media (absent in feature 002 tests). */
  media?: MediaStoragePort;
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
  interviewContent: number;
  documentText: number;
  versions: number;
  unusedMedia: number;
  deletedMedia: number;
  aiRequests: number;
  stayLinks: number;
  propertyLinks: number;
  conversations: number;
  chatUsage: number;
  assistantTests: number;
  instructionVersions: number;
  copilotRuns: number;
  presence: number;
  serviceRequests: number;
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

  // Feature 003 (data model §6).
  const interviewContent = await db
    .update(interviewTurn)
    .set({ answerText: null, transcript: null, contentDeletedAt: now })
    .where(
      and(
        isNull(interviewTurn.contentDeletedAt),
        lt(interviewTurn.createdAt, weekAgo),
        or(isNotNull(interviewTurn.answerText), isNotNull(interviewTurn.transcript)),
      ),
    )
    .returning({ id: interviewTurn.id });

  const documentText = await db
    .update(guideDocument)
    .set({ text: null, textDeletedAt: now })
    .where(
      and(
        isNull(guideDocument.textDeletedAt),
        isNotNull(guideDocument.text),
        lt(sql`coalesce(${guideDocument.readAt}, ${guideDocument.createdAt})`, weekAgo),
      ),
    )
    .returning({ id: guideDocument.id });

  // Versions beyond the latest 20 of each guide, never the one guests read.
  const versions = await db.execute<{ id: string }>(sql`
    DELETE FROM guide_version v
    USING (
      SELECT id, row_number() OVER (PARTITION BY guide_id ORDER BY number DESC) AS rank
      FROM guide_version
    ) ranked
    WHERE v.id = ranked.id
      AND ranked.rank > ${KEPT_VERSIONS}
      AND NOT EXISTS (SELECT 1 FROM guide g WHERE g.published_version_id = v.id)
    RETURNING v.id
  `);

  // Media nothing uses any more starts its 24 hours; media used again stops them.
  const usage = sql`(
    EXISTS (SELECT 1 FROM guide_item i WHERE i.media_id = ${mediaObject.id})
    OR EXISTS (
      SELECT 1 FROM guide_version v
      WHERE v.workspace_id = ${mediaObject.workspaceId}
        AND jsonb_path_exists(v.snapshot, '$.** ? (@.mediaId == $id)', jsonb_build_object('id', ${mediaObject.id}::text))
    )
    OR EXISTS (
      SELECT 1 FROM shared_block b
      WHERE b.workspace_id = ${mediaObject.workspaceId}
        AND b.published_snapshot IS NOT NULL
        AND jsonb_path_exists(b.published_snapshot, '$.** ? (@.mediaId == $id)', jsonb_build_object('id', ${mediaObject.id}::text))
    )
  )`;
  await db
    .update(mediaObject)
    .set({ unreferencedSince: null })
    .where(and(isNotNull(mediaObject.unreferencedSince), usage));
  const unusedMedia = await db
    .update(mediaObject)
    .set({ unreferencedSince: now })
    .where(
      and(
        isNull(mediaObject.unreferencedSince),
        inArray(mediaObject.status, ["ready", "rejected"]),
        lt(mediaObject.createdAt, daysBefore(now, 1)),
        sql`NOT ${usage}`,
      ),
    )
    .returning({ id: mediaObject.id });
  const doomed = await db
    .select({ id: mediaObject.id, prefix: mediaObject.objectPrefix })
    .from(mediaObject)
    .where(
      and(
        isNotNull(mediaObject.unreferencedSince),
        lt(mediaObject.unreferencedSince, daysBefore(now, 1)),
      ),
    )
    .limit(MEDIA_BATCH);
  let deletedMedia = 0;
  if (deps.media) {
    for (const item of doomed) {
      // Objects first: a row left behind is retried tomorrow.
      await deps.media.deletePrefix(item.prefix);
      await db.delete(mediaObject).where(eq(mediaObject.id, item.id));
      deletedMedia += 1;
    }
  }

  const aiRequests = await db
    .delete(guideAiRequest)
    .where(
      lt(guideAiRequest.createdAt, new Date(`${monthsBefore(now, AI_REQUEST_MONTHS)}T00:00:00Z`)),
    )
    .returning({ id: guideAiRequest.id });

  // Feature 004 (data model §7): stay links and their device sessions 30 days after the stay
  // window closed (checkout plus 2 hours, so one more day covers every time zone) or after the
  // link was revoked or replaced, and replaced property links after 30 days.
  const monthAgo = daysBefore(now, 30);
  const stayLinks = await db.execute<{ id: string }>(sql`
    DELETE FROM stay_link l
    USING stay s
    WHERE s.id = l.stay_id
      AND (
        (l.status <> 'active' AND l.ended_at < ${monthAgo})
        OR s.checkout_date < ${monthAgo.toISOString().slice(0, 10)}::date - 1
        OR (s.status = 'cancelled' AND s.cancelled_at < ${monthAgo})
      )
    RETURNING l.id
  `);
  const propertyLinks = await db
    .delete(guideLink)
    .where(and(eq(guideLink.status, "replaced"), lt(guideLink.replacedAt, monthAgo)))
    .returning({ id: guideLink.id });

  // Feature 005 (data model §5, FR-033): conversations, with their messages, drafts, and traces by
  // cascade, 12 months after the stay's checkout, or 12 months after the last message when the
  // conversation has no stay; daily chat usage after 13 months.
  const conversationCutoff = monthsBefore(now, CONVERSATION_MONTHS);
  const conversations = await db.execute<{ id: string }>(sql`
    DELETE FROM conversation
    WHERE id IN (
      SELECT c.id
        FROM conversation c
        LEFT JOIN stay s ON s.id = c.stay_id
       WHERE (s.id IS NOT NULL AND s.checkout_date < ${conversationCutoff}::date)
          OR (s.id IS NULL AND c.last_message_at < ${conversationCutoff}::date)
       LIMIT ${CONVERSATION_BATCH}
    )
    RETURNING id
  `);
  const chatUsage = await db
    .delete(chatUsageDaily)
    .where(lt(chatUsageDaily.day, monthsBefore(now, CHAT_USAGE_MONTHS)))
    .returning({ day: chatUsageDaily.day });

  // Feature 007: tests and their traces (cascade) after 30 days; instruction versions no settings
  // row points to and no trace refers to (FR-021: versions live as long as the traces they explain).
  const assistantTests = await db.execute<{ id: string }>(sql`
    DELETE FROM assistant_test WHERE created_at < ${daysBefore(now, ASSISTANT_TEST_DAYS).toISOString()}::timestamptz
    RETURNING id
  `);
  const copilotRuns = await db.execute<{ id: string }>(sql`
    DELETE FROM copilot_run WHERE created_at < ${daysBefore(now, COPILOT_RUN_DAYS).toISOString()}::timestamptz
    RETURNING id
  `);
  const presence = await db.execute<{ user_id: string }>(sql`
    DELETE FROM conversation_presence
     WHERE expires_at < ${new Date(now.getTime() - PRESENCE_GRACE_MS).toISOString()}::timestamptz
    RETURNING user_id
  `);
  const instructionVersions = await db.execute<{ id: string }>(sql`
    DELETE FROM assistant_instruction_version
    WHERE id IN (
      SELECT v.id FROM assistant_instruction_version v
       WHERE NOT EXISTS (SELECT 1 FROM assistant_settings s WHERE s.instruction_version_id = v.id)
         AND NOT EXISTS (
           SELECT 1 FROM agent_trace t
            WHERE t.workspace_instruction_version_id = v.id OR t.property_instruction_version_id = v.id
         )
       LIMIT ${INSTRUCTION_BATCH}
    )
    RETURNING id
  `);

  // Feature 008 (research R9): requests 12 months after their stay's checkout; the daily counts
  // carry no personal data and stay for analytics (spec 010).
  const serviceRequests = await db.execute<{ id: string }>(sql`
    DELETE FROM service_request
    WHERE id IN (
      SELECT r.id
        FROM service_request r
        JOIN stay s ON s.id = r.stay_id
       WHERE s.checkout_date < ${monthsBefore(now, SERVICE_REQUEST_MONTHS)}::date
       LIMIT ${SERVICE_REQUEST_BATCH}
    )
    RETURNING id
  `);

  return {
    serviceRequests: serviceRequests.rows.length,
    conversations: conversations.rows.length,
    chatUsage: chatUsage.length,
    assistantTests: assistantTests.rows.length,
    instructionVersions: instructionVersions.rows.length,
    copilotRuns: copilotRuns.rows.length,
    presence: presence.rows.length,
    stayLinks: stayLinks.rows.length,
    propertyLinks: propertyLinks.length,
    interviewContent: interviewContent.length,
    documentText: documentText.length,
    versions: versions.rows.length,
    unusedMedia: unusedMedia.length,
    deletedMedia,
    aiRequests: aiRequests.length,
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
          "retention.interview_content": counts.interviewContent,
          "retention.document_text": counts.documentText,
          "retention.versions": counts.versions,
          "retention.unused_media": counts.unusedMedia,
          "retention.deleted_media": counts.deletedMedia,
          "retention.ai_requests": counts.aiRequests,
          "retention.stay_links": counts.stayLinks,
          "retention.property_links": counts.propertyLinks,
          "retention.conversations": counts.conversations,
          "retention.chat_usage": counts.chatUsage,
          "retention.assistant_tests": counts.assistantTests,
          "retention.instruction_versions": counts.instructionVersions,
          "retention.copilot_runs": counts.copilotRuns,
          "retention.presence": counts.presence,
          "retention.service_requests": counts.serviceRequests,
        });
      },
      deps.span,
    );
  };
}
