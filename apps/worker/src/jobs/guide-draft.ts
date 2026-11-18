import { and, asc, eq, sql } from "drizzle-orm";
import {
  guide,
  guideItem,
  guideItemText,
  guideSection,
  listingContent,
  property,
  type Database,
} from "@guidesk/db";
import {
  docFromList,
  docFromPlainText,
  docPlainText,
  GUIDE_TOPICS,
  JOB_QUEUES,
  mainLanguage,
  redactRestrictedValues,
  stripUnknownLinks,
  validTopicIds,
  type DefaultSectionKind,
  type GuideDraftJob,
  type SegDocument,
} from "@guidesk/domain";
import {
  LlmTimeoutError,
  LlmUnavailableError,
  type GuideLlmPort,
  type GuideSectionKindValue,
} from "@guidesk/integrations";
import { recordGuideAi, takeGuideAi } from "./guide-ai.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * The guide draft from the property's data (feature 003 FR-004, FR-005, research R16). House rules
 * and amenities are placed without the AI; the listing description is split across sections by
 * one `draftFromListing` call, after the restricted-value detector (FR-025). Every item it adds is
 * unreviewed and labeled with its source; nothing is published.
 */
export interface GuideDraftDeps {
  db: Database;
  llm: GuideLlmPort;
  span?: JobSpanDeps;
}

/** The AI part has 60 seconds, as listing extraction does. */
const DRAFT_TIMEOUT_MS = 60_000;

const PROVIDER_NAMES: Record<string, string> = { beds24: "Beds24", hostex: "Hostex" };

export type GuideDraftOutcome =
  "drafted" | "placed_only" | "skipped" | "waiting_limit" | "failed" | "timeout" | "ai_unavailable";

interface ListingSource {
  source: "listing" | "pms";
  detail: string | null;
}

function sourceOf(row: { source: string }, provider: string | null): ListingSource | null {
  if (row.source === "listing_text" || row.source === "screenshot")
    return { source: "listing", detail: null };
  if (row.source === "pms")
    return { source: "pms", detail: provider ? (PROVIDER_NAMES[provider] ?? provider) : null };
  return null;
}

const TOPIC_HINTS = GUIDE_TOPICS.map((topic) => ({
  id: topic.id,
  sectionKind: topic.section as GuideSectionKindValue,
}));

export async function runGuideDraft(
  deps: GuideDraftDeps,
  job: GuideDraftJob,
): Promise<GuideDraftOutcome> {
  const { db } = deps;
  const [row] = await db
    .select({
      guideId: guide.id,
      draftState: guide.draftState,
      propertyId: property.id,
      status: property.status,
      languages: property.guideLanguages,
      provider: property.sourceProvider,
    })
    .from(guide)
    .innerJoin(property, eq(property.id, guide.propertyId))
    .where(and(eq(guide.id, job.guideId), eq(guide.workspaceId, job.workspaceId)))
    .limit(1);
  // Not visible yet: the request that queued it may still be committing, so pg-boss retries.
  if (!row) throw new Error("guide not found yet");
  if (row.status !== "active") return "skipped";
  const language = mainLanguage(row.languages);
  const sections = await db
    .select({ id: guideSection.id, kind: guideSection.kind })
    .from(guideSection)
    .where(eq(guideSection.guideId, row.guideId))
    .orderBy(asc(guideSection.position));
  const sectionId = new Map(sections.map((section) => [section.kind, section.id]));
  const target = job.sectionId
    ? sections.find((section) => section.id === job.sectionId)
    : undefined;
  if (job.sectionId && !target) return "skipped";

  const content = await db
    .select({
      kind: listingContent.kind,
      body: listingContent.body,
      items: listingContent.items,
      source: listingContent.source,
      language: listingContent.language,
    })
    .from(listingContent)
    .where(eq(listingContent.propertyId, row.propertyId));
  const byKind = new Map(content.map((item) => [item.kind, item]));

  /** Adds unreviewed items to a section, after its own, and moves its revision on (R17). */
  const addItems = async (
    kind: DefaultSectionKind,
    docs: { doc: SegDocument; topics: string[]; itemLanguage: "es" | "en" }[],
    source: ListingSource,
  ): Promise<void> => {
    const id = sectionId.get(kind);
    if (!id || docs.length === 0) return;
    await db.transaction(async (tx) => {
      const [{ next } = { next: 0 }] = await tx
        .select({ next: sql<number>`coalesce(max(${guideItem.position}) + 1, 0)::int` })
        .from(guideItem)
        .where(eq(guideItem.sectionId, id));
      for (const [index, entry] of docs.entries()) {
        const [item] = await tx
          .insert(guideItem)
          .values({
            workspaceId: job.workspaceId,
            sectionId: id,
            kind: "text",
            position: next + index,
            source: source.source,
            sourceDetail: source.detail,
            sourceLanguage: entry.itemLanguage,
            topics: validTopicIds(entry.topics),
          })
          .returning({ id: guideItem.id });
        const plain = docPlainText(entry.doc);
        await tx.insert(guideItemText).values({
          itemId: item!.id,
          language: entry.itemLanguage,
          workspaceId: job.workspaceId,
          doc: entry.doc,
          textLength: plain.replace(/\n/g, "").length,
          origin: "source",
          state: "current",
        });
      }
      await tx
        .update(guideSection)
        .set({ revision: sql`${guideSection.revision} + 1` })
        .where(eq(guideSection.id, id));
      // A guide that was ever published now differs from what guests read (FR-053).
      await tx
        .update(guide)
        .set({ hasUnpublishedChanges: sql`${guide.status} <> 'draft'` })
        .where(eq(guide.id, row.guideId));
    });
  };

  const itemLanguage = (value: string | null): "es" | "en" =>
    value === "es" || value === "en" ? value : language;

  // 1. Deterministic placement, once, on the full draft (FR-004).
  if (!job.sectionId && row.draftState !== "ready") {
    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(guideItem)
      .innerJoin(guideSection, eq(guideSection.id, guideItem.sectionId))
      .where(
        and(eq(guideSection.guideId, row.guideId), sql`${guideItem.source} IN ('listing', 'pms')`),
      );
    if ((existing[0]?.count ?? 0) === 0) {
      const rules = byKind.get("house_rules");
      const rulesSource = rules ? sourceOf(rules, row.provider) : null;
      if (rules?.body && rulesSource) {
        const clean = redactRestrictedValues(rules.body).text;
        await addItems(
          "house_rules",
          [
            {
              doc: docFromPlainText(clean),
              topics: [],
              itemLanguage: itemLanguage(rules.language),
            },
          ],
          rulesSource,
        );
      }
      const amenities = byKind.get("amenities");
      const amenitiesSource = amenities ? sourceOf(amenities, row.provider) : null;
      if (amenities?.items?.length && amenitiesSource) {
        await addItems(
          "amenities",
          [
            {
              doc: docFromList(amenities.items),
              topics: ["amenities.list"],
              itemLanguage: itemLanguage(amenities.language),
            },
          ],
          amenitiesSource,
        );
      }
    }
  }

  // 2. The description, split across sections by the model (FR-004, FR-007).
  const description = byKind.get("description");
  const descriptionSource = description ? sourceOf(description, row.provider) : null;
  if (!description?.body || !descriptionSource) {
    await setState(db, row.guideId, "ready");
    return "placed_only";
  }
  const limit = job.limitTaken ? { allowed: true } : await takeGuideAi(db, job.workspaceId);
  if (!limit.allowed) {
    await setState(db, row.guideId, "waiting_limit");
    return "waiting_limit";
  }
  const redacted = redactRestrictedValues(description.body).text;
  let result;
  try {
    result = await deps.llm.draftFromListing(
      { language, description: redacted, topics: TOPIC_HINTS },
      { signal: AbortSignal.timeout(DRAFT_TIMEOUT_MS) },
    );
  } catch (error: unknown) {
    const outcome = error instanceof LlmTimeoutError ? "timeout" : "unavailable";
    await recordGuideAi(db, {
      workspaceId: job.workspaceId,
      guideId: row.guideId,
      kind: "draft_listing",
      outcome,
    });
    if (error instanceof LlmTimeoutError || error instanceof LlmUnavailableError) {
      await setState(db, row.guideId, "failed");
      return outcome === "timeout" ? "timeout" : "ai_unavailable";
    }
    throw error;
  }
  await recordGuideAi(db, {
    workspaceId: job.workspaceId,
    guideId: row.guideId,
    kind: "draft_listing",
    result,
  });
  if (result.outcome !== "ok" || !result.result) {
    await setState(db, row.guideId, "failed");
    return "failed";
  }
  const grouped = new Map<
    DefaultSectionKind,
    { doc: SegDocument; topics: string[]; itemLanguage: "es" | "en" }[]
  >();
  for (const item of result.result.items) {
    if (target && item.sectionKind !== target.kind) continue;
    // A second line of defense: the detector runs on the output too (research R5).
    const text = redactRestrictedValues(stripUnknownLinks(item.text, redacted)).text.trim();
    if (!text) continue;
    const list = grouped.get(item.sectionKind) ?? [];
    list.push({ doc: docFromPlainText(text), topics: item.topics, itemLanguage: language });
    grouped.set(item.sectionKind, list);
  }
  for (const [kind, docs] of grouped) await addItems(kind, docs, descriptionSource);
  await setState(db, row.guideId, "ready");
  return "drafted";
}

async function setState(
  db: Database,
  guideId: string,
  draftState: "ready" | "waiting_limit" | "failed",
): Promise<void> {
  await db.update(guide).set({ draftState }).where(eq(guide.id, guideId));
}

/** The pg-boss handler: one span per job (constitution VIII), counts and outcome only. */
export function createGuideDraftHandler(deps: GuideDraftDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<GuideDraftJob>;
      if (typeof data.guideId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload: GuideDraftJob = {
        guideId: data.guideId,
        workspaceId: data.workspaceId,
        ...(typeof data.sectionId === "string" ? { sectionId: data.sectionId } : {}),
        ...(data.limitTaken === true ? { limitTaken: true } : {}),
      };
      await runInJobSpan(
        { queue: JOB_QUEUES.guideDraft, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await runGuideDraft(deps, payload);
          span.set({ "job.outcome": outcome });
          if (outcome === "timeout" || outcome === "ai_unavailable" || outcome === "failed")
            span.recordFailure(outcome);
        },
        deps.span,
      );
    }
  };
}
