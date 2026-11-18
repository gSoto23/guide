import { and, eq, inArray, sql } from "drizzle-orm";
import {
  guide,
  guideItem,
  guideItemText,
  guideSection,
  property,
  sharedBlock,
  type Database,
} from "@guidesk/db";
import {
  afterTranslation,
  docPlainText,
  JOB_QUEUES,
  maskRestrictedValues,
  rebuildDocument,
  segmentDocument,
  textHash,
  tokensMatch,
  unmaskRestrictedValues,
  type GuideTranslateJob,
  type SegDocument,
} from "@guidesk/domain";
import { LlmTimeoutError, LlmUnavailableError, type GuideLlmPort } from "@guidesk/integrations";
import { recordGuideAi, takeGuideAi } from "./guide-ai.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Translation of one section into one language (feature 003 US5, research R7, FR-044 to FR-047):
 * every item whose text in that language is missing, stale, or pending is segmented into tagged
 * blocks, restricted values are masked as `{{R1}}` (FR-025), and one `translateBlocks` call
 * translates them. Each block must keep its tags and placeholders; a mismatch is retried once and
 * then marked `failed`. Reviewed translations are never overwritten, and a source that changed
 * during the call is left for the next job.
 */
export interface GuideTranslateDeps {
  db: Database;
  llm: GuideLlmPort;
  span?: JobSpanDeps;
}

const TRANSLATE_TIMEOUT_MS = 60_000;

/** The sweep for translation work nothing scheduled (research R7), every minute. */
export const GUIDE_TRANSLATE_SWEEP_QUEUE = "guide.translate-sweep";
export const GUIDE_TRANSLATE_SWEEP_CRON = "* * * * *";

export type GuideTranslateOutcome =
  "translated" | "partial" | "nothing_to_do" | "waiting_limit" | "ai_unavailable" | "failed";

interface Candidate {
  itemId: string;
  sourceLanguage: "es" | "en";
  source: SegDocument;
  sourceHash: string;
  /** The blocks after masking, and the values each block's placeholders stand for. */
  blocks: string[];
  values: string[][];
}

/** The source hash the API stores with a translation (feature 003 data model §1). */
export function sourceHashOf(doc: unknown): string {
  return textHash(JSON.stringify(doc));
}

export async function runGuideTranslate(
  deps: GuideTranslateDeps,
  job: GuideTranslateJob,
): Promise<GuideTranslateOutcome> {
  const { db } = deps;
  let owner: { sectionId: string } | { sharedBlockId: string };
  let guideId: string | null = null;
  if (job.sectionId) {
    const [section] = await db
      .select({
        id: guideSection.id,
        guideId: guideSection.guideId,
        languages: property.guideLanguages,
      })
      .from(guideSection)
      .innerJoin(guide, eq(guide.id, guideSection.guideId))
      .innerJoin(property, eq(property.id, guide.propertyId))
      .where(and(eq(guideSection.id, job.sectionId), eq(guideSection.workspaceId, job.workspaceId)))
      .limit(1);
    // A single-language guide, or a language it no longer has, needs nothing (US5 scenario 6).
    if (!section || section.languages.length < 2 || !section.languages.includes(job.language)) {
      return "nothing_to_do";
    }
    owner = { sectionId: section.id };
    guideId = section.guideId;
  } else if (job.sharedBlockId) {
    // Shared blocks are kept in both languages, once per workspace (research R7, R14).
    const [block] = await db
      .select({ id: sharedBlock.id })
      .from(sharedBlock)
      .where(
        and(eq(sharedBlock.id, job.sharedBlockId), eq(sharedBlock.workspaceId, job.workspaceId)),
      )
      .limit(1);
    if (!block) return "nothing_to_do";
    owner = { sharedBlockId: block.id };
  } else {
    return "nothing_to_do";
  }

  const candidates = await loadCandidates(db, owner, job.language);
  if (candidates.length === 0) return "nothing_to_do";

  const limit = await takeGuideAi(db, job.workspaceId);
  if (!limit.allowed) {
    await markAll(db, candidates, job, { state: "pending", pendingReason: "ai_limit" });
    return "waiting_limit";
  }

  let outcome: GuideTranslateOutcome = "translated";
  // Items are grouped by source language; a guide written in one language makes one call.
  for (const from of ["es", "en"] as const) {
    const group = candidates.filter((candidate) => candidate.sourceLanguage === from);
    if (group.length === 0 || from === job.language) continue;
    const result = await translateGroup(deps, job, guideId, from, group);
    if (result === "ai_unavailable") return "ai_unavailable";
    if (result !== "translated") outcome = result;
  }
  return outcome;
}

/** Items of the section or block that need a text in `language`, with their masked blocks. */
async function loadCandidates(
  db: Database,
  owner: { sectionId: string } | { sharedBlockId: string },
  language: "es" | "en",
): Promise<Candidate[]> {
  const items = await db
    .select({ id: guideItem.id, sourceLanguage: guideItem.sourceLanguage })
    .from(guideItem)
    .where(
      and(
        "sectionId" in owner
          ? eq(guideItem.sectionId, owner.sectionId)
          : eq(guideItem.sharedBlockId, owner.sharedBlockId),
        sql`${guideItem.kind} <> 'fact'`,
      ),
    );
  if (items.length === 0) return [];
  const texts = await db
    .select({
      itemId: guideItemText.itemId,
      language: guideItemText.language,
      doc: guideItemText.doc,
      state: guideItemText.state,
    })
    .from(guideItemText)
    .where(
      inArray(
        guideItemText.itemId,
        items.map((item) => item.id),
      ),
    );
  const candidates: Candidate[] = [];
  for (const item of items) {
    if (item.sourceLanguage === language) continue;
    const source = texts.find(
      (text) => text.itemId === item.id && text.language === item.sourceLanguage,
    );
    if (!source?.doc || !docPlainText(source.doc as SegDocument).trim()) continue;
    const target = texts.find((text) => text.itemId === item.id && text.language === language);
    if (target && target.state !== "stale" && target.state !== "pending") continue;
    const { segments } = segmentDocument(source.doc as SegDocument);
    const masked = segments.map((segment) => maskRestrictedValues(segment));
    candidates.push({
      itemId: item.id,
      sourceLanguage: item.sourceLanguage,
      source: source.doc as SegDocument,
      sourceHash: sourceHashOf(source.doc),
      blocks: masked.map((entry) => entry.text),
      values: masked.map((entry) => entry.values),
    });
  }
  return candidates;
}

async function translateGroup(
  deps: GuideTranslateDeps,
  job: GuideTranslateJob,
  guideId: string | null,
  from: "es" | "en",
  group: Candidate[],
): Promise<"translated" | "partial" | "ai_unavailable" | "failed"> {
  const { db } = deps;
  let pending = [...group];
  let stored = 0;
  // One call, and one retry for the items whose tags or placeholders came back wrong (R7).
  for (let attempt = 0; attempt < 2 && pending.length > 0; attempt += 1) {
    // Empty blocks are never sent; they stay empty.
    const sent: { candidate: Candidate; block: number }[] = [];
    for (const candidate of pending) {
      candidate.blocks.forEach((block, index) => {
        if (block.trim()) sent.push({ candidate, block: index });
      });
    }
    let result;
    try {
      result = await deps.llm.translateBlocks(
        {
          from,
          to: job.language,
          blocks: sent.map((entry) => entry.candidate.blocks[entry.block]!),
        },
        { signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS) },
      );
    } catch (error: unknown) {
      if (error instanceof LlmTimeoutError || error instanceof LlmUnavailableError) {
        await recordGuideAi(db, {
          workspaceId: job.workspaceId,
          guideId,
          kind: "translation",
          outcome: error instanceof LlmTimeoutError ? "timeout" : "unavailable",
        });
        await markAll(db, pending, job, { state: "pending", pendingReason: "ai_unavailable" });
        return "ai_unavailable";
      }
      throw error;
    }
    await recordGuideAi(db, { workspaceId: job.workspaceId, guideId, kind: "translation", result });
    const answer =
      result.outcome === "ok" && result.result?.blocks.length === sent.length
        ? result.result.blocks
        : null;
    const retry: Candidate[] = [];
    for (const candidate of pending) {
      const strings = candidate.blocks.map((block, index) => {
        if (!block.trim()) return block;
        const position = sent.findIndex(
          (entry) => entry.candidate === candidate && entry.block === index,
        );
        const translated = answer?.[position];
        // Tags and placeholders must come back exactly, before the values are restored.
        if (translated === undefined || !tokensMatch(block, translated)) return undefined;
        return unmaskRestrictedValues(translated, candidate.values[index] ?? []);
      });
      const rebuilt = strings.every((value) => value !== undefined)
        ? rebuildDocument(candidate.source, strings as string[])
        : null;
      if (!rebuilt?.ok) {
        retry.push(candidate);
        continue;
      }
      if (await store(db, job, candidate, rebuilt.doc)) stored += 1;
    }
    pending = retry;
  }
  if (pending.length > 0) {
    await markAll(db, pending, job, { state: "failed", pendingReason: "tokens_mismatch" });
    return stored > 0 ? "partial" : "failed";
  }
  return "translated";
}

/**
 * Stores one translation unless the source changed during the call or the host reviewed the
 * text meanwhile (FR-045); returns whether it was stored.
 */
async function store(
  db: Database,
  job: GuideTranslateJob,
  candidate: Candidate,
  doc: SegDocument,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select({ doc: guideItemText.doc })
      .from(guideItemText)
      .where(
        and(
          eq(guideItemText.itemId, candidate.itemId),
          eq(guideItemText.language, candidate.sourceLanguage),
        ),
      )
      .for("update");
    if (!source || sourceHashOf(source.doc) !== candidate.sourceHash) return false;
    const [target] = await tx
      .select({ state: guideItemText.state })
      .from(guideItemText)
      .where(
        and(eq(guideItemText.itemId, candidate.itemId), eq(guideItemText.language, job.language)),
      )
      .for("update");
    if (target && target.state !== "stale" && target.state !== "pending") return false;
    const status = afterTranslation();
    const values = {
      doc,
      textLength: docPlainText(doc).replace(/\n/g, "").length,
      origin: status.origin,
      state: status.state,
      pendingReason: null,
      sourceHash: candidate.sourceHash,
    };
    await tx
      .insert(guideItemText)
      .values({
        itemId: candidate.itemId,
        language: job.language,
        workspaceId: job.workspaceId,
        ...values,
      })
      .onConflictDoUpdate({ target: [guideItemText.itemId, guideItemText.language], set: values });
    return true;
  });
}

/** Marks texts pending or failed with a reason the host sees (US5 scenario 7). */
async function markAll(
  db: Database,
  candidates: Candidate[],
  job: GuideTranslateJob,
  status: {
    state: "pending" | "failed";
    pendingReason: "ai_limit" | "ai_unavailable" | "tokens_mismatch";
  },
): Promise<void> {
  for (const candidate of candidates) {
    await db
      .insert(guideItemText)
      .values({
        itemId: candidate.itemId,
        language: job.language,
        workspaceId: job.workspaceId,
        doc: null,
        origin: "machine",
        state: status.state,
        pendingReason: status.pendingReason,
      })
      .onConflictDoUpdate({
        target: [guideItemText.itemId, guideItemText.language],
        set: { state: status.state, pendingReason: status.pendingReason },
        where: sql`${guideItemText.state} IN ('stale', 'pending')`,
      });
  }
}

/**
 * Finds sections with texts waiting for a translation that no save scheduled: items drafted by
 * the worker, restored versions, and added guide languages (research R7). Runs every minute;
 * texts saved in the last 20 seconds are left to their own debounced job.
 */
export async function findTranslationWork(db: Database, limit = 200): Promise<GuideTranslateJob[]> {
  const result = await db.execute<{
    workspace_id: string;
    section_id: string;
    language: "es" | "en";
  }>(sql`
    SELECT DISTINCT i.workspace_id, i.section_id, l.language
    FROM guide_item i
    JOIN guide_section s ON s.id = i.section_id
    JOIN guide g ON g.id = s.guide_id
    JOIN property p ON p.id = g.property_id AND p.status = 'active'
    CROSS JOIN LATERAL unnest(p.guide_languages) AS l(language)
    JOIN guide_item_text src
      ON src.item_id = i.id AND src.language = i.source_language AND src.doc IS NOT NULL
    LEFT JOIN guide_item_text t ON t.item_id = i.id AND t.language = l.language
    WHERE l.language <> i.source_language
      AND i.kind <> 'fact'
      AND cardinality(p.guide_languages) > 1
      AND src.updated_at < now() - interval '20 seconds'
      AND (
        t.item_id IS NULL
        OR (t.state = 'stale' AND t.updated_at < now() - interval '20 seconds')
        OR (t.state = 'pending' AND t.updated_at < now() - interval '10 minutes')
      )
    LIMIT ${limit}
  `);
  return result.rows.map((row) => ({
    workspaceId: row.workspace_id,
    sectionId: row.section_id,
    language: row.language,
  }));
}

/** The pg-boss handler: one span per job (constitution VIII), outcome only, never text. */
export function createGuideTranslateHandler(deps: GuideTranslateDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<GuideTranslateJob>;
      if (
        typeof data.workspaceId !== "string" ||
        (typeof data.sectionId !== "string" && typeof data.sharedBlockId !== "string") ||
        (data.language !== "es" && data.language !== "en")
      ) {
        continue;
      }
      const payload: GuideTranslateJob = {
        workspaceId: data.workspaceId,
        ...(typeof data.sectionId === "string"
          ? { sectionId: data.sectionId }
          : { sharedBlockId: data.sharedBlockId as string }),
        language: data.language,
      };
      await runInJobSpan(
        { queue: JOB_QUEUES.guideTranslate, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await runGuideTranslate(deps, payload);
          span.set({ "job.outcome": outcome });
          if (outcome === "failed" || outcome === "ai_unavailable") span.recordFailure(outcome);
        },
        deps.span,
      );
    }
  };
}
