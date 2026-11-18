import { and, eq, sql } from "drizzle-orm";
import {
  guide,
  guideDocument,
  guideItem,
  guideItemText,
  guideSection,
  property,
  upload,
  type Database,
} from "@guidesk/db";
import {
  docFromPlainText,
  docPlainText,
  GUIDE_TOPICS,
  JOB_QUEUES,
  mainLanguage,
  redactRestrictedValues,
  stripUnknownLinks,
  validTopicIds,
  type DefaultSectionKind,
  type GuideDocumentJob,
} from "@guidesk/domain";
import {
  LlmTimeoutError,
  LlmUnavailableError,
  type GuideLlmPort,
  type ObjectStoragePort,
  type SandboxPort,
} from "@guidesk/integrations";
import { recordGuideAi, takeGuideAi } from "./guide-ai.js";
import { ScanPendingError } from "./media-process.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * A manual or photo read for knowledge (feature 003 US6, research R9, FR-039 to FR-043): waits
 * for the malware scan, has the file processor read its text (the file is deleted there in every
 * case), stores the text after the restricted-value detector, and makes one `suggestFromDocument`
 * call. Suggestions are unreviewed `document` items labeled with the file name. No image ever
 * reaches the model (AC-SEC-005), and text inside the file is data, never instructions (AC-SEC-007).
 */
export interface GuideDocumentDeps {
  db: Database;
  sandbox: SandboxPort;
  storage: ObjectStoragePort;
  llm: GuideLlmPort;
  /** True in AWS: GuardDuty's scan result must be in before the file is read. */
  requireScan: boolean;
  span?: JobSpanDeps;
}

const SUGGEST_TIMEOUT_MS = 60_000;
/** What one call reads (research R6). */
const MODEL_TEXT_CHARS = 60_000;
const REASONS = new Set([
  "unsupported_type",
  "too_large",
  "too_many_pages",
  "password_protected",
  "unreadable",
]);
const TOPIC_HINTS = GUIDE_TOPICS.map((topic) => ({ id: topic.id, sectionKind: topic.section }));

export type GuideDocumentOutcome =
  "suggested" | "nothing_found" | "rejected" | "waiting_limit" | "ai_unavailable" | "skipped";

export async function runGuideDocument(
  deps: GuideDocumentDeps,
  job: GuideDocumentJob,
): Promise<GuideDocumentOutcome> {
  const { db } = deps;
  const [row] = await db
    .select({
      id: guideDocument.id,
      guideId: guideDocument.guideId,
      kind: guideDocument.kind,
      status: guideDocument.status,
      fileName: guideDocument.fileName,
      uploadId: upload.id,
      objectKey: upload.objectKey,
      languages: property.guideLanguages,
    })
    .from(guideDocument)
    .innerJoin(guide, eq(guide.id, guideDocument.guideId))
    .innerJoin(property, eq(property.id, guide.propertyId))
    .leftJoin(upload, eq(upload.guideDocumentId, guideDocument.id))
    .where(
      and(eq(guideDocument.id, job.documentId), eq(guideDocument.workspaceId, job.workspaceId)),
    )
    .limit(1);
  if (!row || row.status !== "checking" || !row.objectKey) return "skipped";

  const finish = async (
    status: "done" | "rejected",
    rejectReason: string | null,
    extra: Partial<typeof guideDocument.$inferInsert> = {},
  ): Promise<void> => {
    await db
      .update(guideDocument)
      .set({ status, rejectReason, ...extra })
      .where(eq(guideDocument.id, row.id));
    if (row.uploadId && status === "rejected") {
      await db
        .update(upload)
        .set({ status: "rejected", rejectReason })
        .where(eq(upload.id, row.uploadId));
    }
  };

  if (deps.requireScan) {
    const scan = await deps.storage.scanStatus(row.objectKey);
    if (scan === "pending") throw new ScanPendingError();
    if (scan === "threats" || scan === "failed") {
      await deps.storage.delete(row.objectKey);
      await finish("rejected", scan === "threats" ? "malware" : "unreadable");
      return "rejected";
    }
  }

  await db.update(guideDocument).set({ status: "reading" }).where(eq(guideDocument.id, row.id));
  // PDFs are read page by page; photos by recognition, as screenshots are (R9).
  const response = await deps.sandbox.processFile({
    objectKey: row.objectKey,
    purpose: row.kind === "pdf" ? "document" : "screenshot",
  });
  if ("error" in response) {
    await finish("rejected", REASONS.has(response.error) ? response.error : "unreadable");
    return "rejected";
  }
  if (!("text" in response)) {
    await finish("rejected", "unreadable");
    return "rejected";
  }

  const redacted = redactRestrictedValues(response.text);
  const text = redacted.text.slice(0, 200_000);
  await db
    .update(guideDocument)
    .set({
      text,
      redactions: redacted.counts as Record<string, number>,
      pages: "pages" in response ? response.pages : null,
      scannedPages: "scannedPages" in response ? response.scannedPages : null,
      readAt: new Date(),
    })
    .where(eq(guideDocument.id, row.id));
  if (!text.trim()) {
    await finish("done", "nothing_found");
    return "nothing_found";
  }

  // The reading counts toward the daily AI limit only when it reaches the model (FR-064).
  const limit = await takeGuideAi(db, job.workspaceId);
  if (!limit.allowed) {
    await finish("rejected", "ai_limit");
    return "waiting_limit";
  }
  const language = mainLanguage(row.languages);
  const input = text.slice(0, MODEL_TEXT_CHARS);
  let result;
  try {
    result = await deps.llm.suggestFromDocument(
      { language, fileName: row.fileName, text: input, topics: TOPIC_HINTS },
      { signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS) },
    );
  } catch (error: unknown) {
    if (error instanceof LlmTimeoutError || error instanceof LlmUnavailableError) {
      await recordGuideAi(db, {
        workspaceId: job.workspaceId,
        guideId: row.guideId,
        kind: "document",
        outcome: error instanceof LlmTimeoutError ? "timeout" : "unavailable",
      });
      await finish("rejected", "ai_unavailable");
      return "ai_unavailable";
    }
    throw error;
  }
  await recordGuideAi(db, {
    workspaceId: job.workspaceId,
    guideId: row.guideId,
    kind: "document",
    result,
  });

  const grouped = new Map<DefaultSectionKind, { text: string; topics: string[] }[]>();
  for (const item of result.outcome === "ok" ? (result.result?.items ?? []) : []) {
    // A second line of defense: the detector runs on the output too (research R5).
    const clean = redactRestrictedValues(stripUnknownLinks(item.text, input)).text.trim();
    if (!clean) continue;
    const list = grouped.get(item.sectionKind) ?? [];
    list.push({ text: clean, topics: validTopicIds(item.topics) });
    grouped.set(item.sectionKind, list);
  }
  const count = [...grouped.values()].reduce((sum, list) => sum + list.length, 0);
  if (count === 0) {
    await finish("done", "nothing_found");
    return "nothing_found";
  }

  await db.transaction(async (tx) => {
    for (const [kind, entries] of grouped) {
      const [section] = await tx
        .select({ id: guideSection.id })
        .from(guideSection)
        .where(and(eq(guideSection.guideId, row.guideId), eq(guideSection.kind, kind)))
        .limit(1);
      if (!section) continue;
      const [{ next } = { next: 0 }] = await tx
        .select({ next: sql<number>`coalesce(max(${guideItem.position}) + 1, 0)::int` })
        .from(guideItem)
        .where(eq(guideItem.sectionId, section.id));
      for (const [index, entry] of entries.entries()) {
        const doc = docFromPlainText(entry.text);
        const [item] = await tx
          .insert(guideItem)
          .values({
            workspaceId: job.workspaceId,
            sectionId: section.id,
            kind: "text",
            position: next + index,
            source: "document",
            sourceDetail: row.fileName.slice(0, 120),
            sourceLanguage: language,
            topics: entry.topics,
            documentId: row.id,
          })
          .returning({ id: guideItem.id });
        await tx.insert(guideItemText).values({
          itemId: item!.id,
          language,
          workspaceId: job.workspaceId,
          doc,
          textLength: docPlainText(doc).replace(/\n/g, "").length,
          origin: "source",
          state: "current",
        });
      }
      await tx
        .update(guideSection)
        .set({ revision: sql`${guideSection.revision} + 1` })
        .where(eq(guideSection.id, section.id));
    }
    await tx
      .update(guide)
      .set({ hasUnpublishedChanges: sql`${guide.status} <> 'draft'` })
      .where(eq(guide.id, row.guideId));
    await tx
      .update(guideDocument)
      .set({ status: "done", rejectReason: null, suggestionCount: count })
      .where(eq(guideDocument.id, row.id));
  });
  return "suggested";
}

/** The pg-boss handler: one span per job (constitution VIII), outcome only, never text. */
export function createGuideDocumentHandler(deps: GuideDocumentDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<GuideDocumentJob>;
      if (typeof data.documentId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload: GuideDocumentJob = {
        workspaceId: data.workspaceId,
        documentId: data.documentId,
      };
      await runInJobSpan(
        { queue: JOB_QUEUES.guideDocument, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await runGuideDocument(deps, payload);
          span.set({ "job.outcome": outcome });
          if (outcome === "rejected" || outcome === "ai_unavailable") span.recordFailure(outcome);
        },
        deps.span,
      );
    }
  };
}
