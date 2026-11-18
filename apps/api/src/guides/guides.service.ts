import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type {
  CodeWarning,
  CreateItemBody,
  CreateSectionBody,
  GuideDocument,
  GuideView,
  OrderItemsBody,
  OrderSectionsBody,
  SectionWriteResult,
  TopicMarkBody,
  UpdateItemBody,
  UpdateSectionBody,
} from "@guidesk/contracts";
import { documentTextLength } from "@guidesk/contracts";
import {
  guide,
  guideItem,
  guideItemText,
  guideSection,
  guideTopicMark,
  mediaObject,
} from "@guidesk/db";
import {
  afterSourceChange,
  docBlockTexts,
  docPlainText,
  isGuideTopicId,
  JOB_QUEUES,
  MAX_CUSTOM_SECTIONS,
  MAX_IMAGES_PER_SECTION,
  MAX_SECTION_TEXT_LENGTH,
  MAX_VIDEOS_PER_SECTION,
  redactRestrictedValues,
  textHash,
  type GuideDraftJob,
  type SegDocument,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { GuideLimitsService } from "./guide-limits.service.js";
import { GuideViewService, type Caller, type GuideContext } from "./guide-view.service.js";

type Language = "es" | "en";

/**
 * Guide writes (feature 003 contract "Guide and sections" and "Items"): sections, items,
 * approvals, order, and topic marks. Every write checks the section's revision (FR-012), keeps
 * section statuses and completeness current (FR-013, FR-031), and marks a published guide as
 * having unpublished changes (FR-053). Writes never change a published version (FR-052).
 */
@Injectable()
export class GuidesService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly views: GuideViewService,
    private readonly crossTenant: CrossTenantService,
    private readonly jobs: JobQueueService,
    private readonly limits: GuideLimitsService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  /** The guide screen. Starts the AI part of the draft the first time a manager opens it (R16). */
  async get(caller: Caller, workspaceId: string, propertyId: string): Promise<GuideView> {
    const ctx = await this.views.load(workspaceId, propertyId);
    if (
      ctx.guide.draftState === "pending" &&
      (caller.role === "owner" || caller.role === "admin")
    ) {
      await this.tx.update(guide).set({ draftState: "drafting" }).where(eq(guide.id, ctx.guide.id));
      await this.jobs.send(
        JOB_QUEUES.guideDraft,
        { guideId: ctx.guide.id, workspaceId } satisfies GuideDraftJob,
        { startAfter: 1, retryLimit: 3, retryBackoff: true, singletonKey: ctx.guide.id },
      );
      ctx.guide.draftState = "drafting";
    }
    return this.views.view(ctx, caller);
  }

  // Sections -----------------------------------------------------------------------------------

  async createSection(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    body: CreateSectionBody,
  ): Promise<SectionWriteResult> {
    const ctx = await this.views.load(workspaceId, propertyId);
    if (ctx.sections.filter((section) => section.kind === "custom").length >= MAX_CUSTOM_SECTIONS) {
      throw new ApiProblem(422, "section_limit", undefined, {
        details: { limit: MAX_CUSTOM_SECTIONS },
      });
    }
    const position =
      body.position ?? Math.max(-1, ...ctx.sections.map((section) => section.position)) + 1;
    const [row] = await this.tx
      .insert(guideSection)
      .values({
        workspaceId,
        guideId: ctx.guide.id,
        kind: "custom",
        title: body.title,
        position,
        updatedBy: caller.userId,
      })
      .returning({ id: guideSection.id });
    return this.finish(workspaceId, propertyId, row!.id);
  }

  async updateSection(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    sectionId: string,
    body: UpdateSectionBody,
  ): Promise<SectionWriteResult> {
    const { section } = await this.sectionOf(workspaceId, propertyId, sectionId);
    if (body.title && section.kind !== "custom") {
      throw new ApiProblem(422, "validation_failed", "Only custom sections have a title.", {
        fields: { title: ["Only custom sections have a title"] },
      });
    }
    if (body.hidden !== undefined && section.kind === "custom") {
      throw new ApiProblem(422, "validation_failed", "Custom sections are deleted, not hidden.", {
        fields: { hidden: ["Only default sections can be hidden"] },
      });
    }
    await this.bump(caller, sectionId, body.revision, {
      ...(body.title ? { title: body.title } : {}),
      ...(body.hidden !== undefined ? { hidden: body.hidden } : {}),
    });
    return this.finish(workspaceId, propertyId, sectionId);
  }

  async orderSections(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    body: OrderSectionsBody,
  ): Promise<GuideView> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const ids = new Set(ctx.sections.map((section) => section.id));
    if (body.sectionIds.length !== ids.size || !body.sectionIds.every((id) => ids.has(id))) {
      throw new ApiProblem(422, "validation_failed", "List every section of the guide once.", {
        fields: { sectionIds: ["List every section of the guide once"] },
      });
    }
    for (const [position, id] of body.sectionIds.entries()) {
      await this.tx
        .update(guideSection)
        .set({ position, updatedBy: caller.userId })
        .where(eq(guideSection.id, id));
    }
    await this.recompute(await this.views.load(workspaceId, propertyId));
    return this.get(caller, workspaceId, propertyId);
  }

  async deleteSection(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    sectionId: string,
  ): Promise<GuideView> {
    const { section } = await this.sectionOf(workspaceId, propertyId, sectionId);
    if (section.kind !== "custom") {
      throw new ApiProblem(
        422,
        "validation_failed",
        "Default sections can be hidden, not deleted.",
      );
    }
    await this.tx.delete(guideSection).where(eq(guideSection.id, sectionId));
    await this.recompute(await this.views.load(workspaceId, propertyId));
    return this.get(caller, workspaceId, propertyId);
  }

  async approveSection(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    sectionId: string,
    revision: number,
  ): Promise<SectionWriteResult> {
    const { ctx } = await this.sectionOf(workspaceId, propertyId, sectionId);
    const pending = ctx.items.filter(
      (item) => item.sectionId === sectionId && item.reviewedAt === null,
    );
    if (pending.some((item) => item.kind === "recommendation" && !item.recommendation?.benefit)) {
      throw new ApiProblem(422, "benefit_required");
    }
    await this.bump(caller, sectionId, revision);
    if (pending.length > 0) {
      await this.tx
        .update(guideItem)
        .set({ reviewedAt: new Date(), reviewedBy: caller.userId, updatedBy: caller.userId })
        .where(and(eq(guideItem.sectionId, sectionId), isNull(guideItem.reviewedAt)));
    }
    return this.finish(workspaceId, propertyId, sectionId);
  }

  /** Drafts a section again from the listing content (FR-007); results arrive unreviewed. */
  async redraftSection(workspaceId: string, propertyId: string, sectionId: string): Promise<void> {
    const { ctx, section } = await this.sectionOf(workspaceId, propertyId, sectionId);
    if (section.kind === "custom") {
      throw new ApiProblem(422, "validation_failed", "Custom sections have no listing content.");
    }
    await this.limits.consumeAi(workspaceId);
    await this.jobs.send(
      JOB_QUEUES.guideDraft,
      { guideId: ctx.guide.id, workspaceId, sectionId, limitTaken: true } satisfies GuideDraftJob,
      { startAfter: 1, retryLimit: 3, retryBackoff: true },
    );
  }

  // Items --------------------------------------------------------------------------------------

  async createItem(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    sectionId: string,
    body: CreateItemBody,
  ): Promise<SectionWriteResult> {
    const { ctx } = await this.sectionOf(workspaceId, propertyId, sectionId);
    this.assertLanguage(ctx, body.language);
    const sectionItems = ctx.items.filter((item) => item.sectionId === sectionId);
    if (body.kind === "image" || body.kind === "video") {
      await this.assertMedia(workspaceId, body.mediaId!, body.kind);
      const limit = body.kind === "image" ? MAX_IMAGES_PER_SECTION : MAX_VIDEOS_PER_SECTION;
      if (sectionItems.filter((item) => item.kind === body.kind).length >= limit) {
        throw new ApiProblem(422, "item_limit", undefined, { details: { limit } });
      }
    }
    if (body.kind === "recommendation" && !body.recommendation?.benefit) {
      throw new ApiProblem(422, "benefit_required");
    }
    if (body.doc) this.assertTextLength(ctx, sectionId, body.language, body.doc);
    await this.bump(caller, sectionId, body.revision);
    const position =
      body.position ?? Math.max(-1, ...sectionItems.map((item) => item.position)) + 1;
    const now = new Date();
    const [row] = await this.tx
      .insert(guideItem)
      .values({
        workspaceId,
        sectionId,
        kind: body.kind,
        position,
        source: "host",
        reviewedAt: now,
        reviewedBy: caller.userId,
        sourceLanguage: body.language,
        mediaId: body.mediaId ?? null,
        recommendation: body.recommendation ?? null,
        updatedBy: caller.userId,
      })
      .returning({ id: guideItem.id });
    if (body.doc) {
      await this.tx.insert(guideItemText).values({
        itemId: row!.id,
        language: body.language,
        workspaceId,
        doc: body.doc,
        textLength: documentTextLength(body.doc),
        origin: "source",
        state: "current",
      });
    }
    return this.finish(
      workspaceId,
      propertyId,
      sectionId,
      row!.id,
      this.warningsOf(body.doc, body.language),
    );
  }

  async updateItem(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    itemId: string,
    body: UpdateItemBody,
  ): Promise<SectionWriteResult> {
    const { ctx, item } = await this.itemOf(workspaceId, propertyId, itemId);
    this.assertLanguage(ctx, body.language);
    if (item.kind === "fact") {
      throw new ApiProblem(422, "validation_failed", "Facts change in the property details.");
    }
    if (body.recommendation && item.kind !== "recommendation") {
      throw new ApiProblem(422, "validation_failed", "Only recommendations have details.");
    }
    const recommendation = body.recommendation ?? item.recommendation;
    if (item.kind === "recommendation" && !recommendation?.benefit) {
      throw new ApiProblem(422, "benefit_required");
    }
    if (body.doc) this.assertTextLength(ctx, item.sectionId!, body.language, body.doc, item.id);
    await this.bump(caller, item.sectionId!, body.revision);
    const now = new Date();
    let ack = item.codeWarningAck;
    if (body.doc) {
      const isSource = body.language === item.sourceLanguage;
      const existing = ctx.texts.find(
        (text) => text.itemId === item.id && text.language === body.language,
      );
      const sourceText = isSource
        ? body.doc
        : (ctx.texts.find(
            (text) => text.itemId === item.id && text.language === item.sourceLanguage,
          )?.doc as GuideDocument | undefined);
      const values = {
        doc: body.doc,
        textLength: documentTextLength(body.doc),
        origin: isSource ? ("source" as const) : ("reviewed" as const),
        state: "current" as const,
        pendingReason: null,
        sourceHash: !isSource && sourceText ? textHash(JSON.stringify(sourceText)) : null,
      };
      if (existing) {
        await this.tx
          .update(guideItemText)
          .set(values)
          .where(and(eq(guideItemText.itemId, item.id), eq(guideItemText.language, body.language)));
      } else {
        await this.tx
          .insert(guideItemText)
          .values({ itemId: item.id, language: body.language, workspaceId, ...values });
      }
      if (isSource) {
        // Other languages follow the source (FR-046); the translation job picks stale texts (US5).
        for (const text of ctx.texts.filter(
          (candidate) => candidate.itemId === item.id && candidate.language !== body.language,
        )) {
          if (text.origin === "source") continue;
          const next = afterSourceChange({ origin: text.origin, state: text.state });
          await this.tx
            .update(guideItemText)
            .set({ state: next.state, origin: next.origin, pendingReason: null })
            .where(
              and(eq(guideItemText.itemId, text.itemId), eq(guideItemText.language, text.language)),
            );
        }
      }
    }
    const sourceDoc =
      body.doc && body.language === item.sourceLanguage
        ? body.doc
        : (ctx.texts.find(
            (text) => text.itemId === item.id && text.language === item.sourceLanguage,
          )?.doc as GuideDocument | undefined);
    if (body.keepCodeWarning && sourceDoc) ack = textHash(docPlainText(sourceDoc as SegDocument));
    await this.tx
      .update(guideItem)
      .set({
        reviewedAt: now,
        reviewedBy: caller.userId,
        updatedBy: caller.userId,
        codeWarningAck: ack,
        ...(body.recommendation ? { recommendation: body.recommendation } : {}),
      })
      .where(eq(guideItem.id, item.id));
    const warnings = body.keepCodeWarning ? [] : this.warningsOf(body.doc, body.language);
    return this.finish(workspaceId, propertyId, item.sectionId!, item.id, warnings);
  }

  async deleteItem(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    itemId: string,
    revision: number,
  ): Promise<SectionWriteResult> {
    const { item } = await this.itemOf(workspaceId, propertyId, itemId);
    if (item.kind === "fact")
      throw new ApiProblem(422, "validation_failed", "Facts cannot be removed.");
    await this.bump(caller, item.sectionId!, revision);
    await this.tx.delete(guideItem).where(eq(guideItem.id, item.id));
    return this.finish(workspaceId, propertyId, item.sectionId!);
  }

  async approveItem(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    itemId: string,
    revision: number,
  ): Promise<SectionWriteResult> {
    const { item } = await this.itemOf(workspaceId, propertyId, itemId);
    if (item.kind === "recommendation" && !item.recommendation?.benefit) {
      throw new ApiProblem(422, "benefit_required");
    }
    await this.bump(caller, item.sectionId!, revision);
    await this.tx
      .update(guideItem)
      .set({ reviewedAt: new Date(), reviewedBy: caller.userId, updatedBy: caller.userId })
      .where(eq(guideItem.id, item.id));
    return this.finish(workspaceId, propertyId, item.sectionId!, item.id);
  }

  async orderItems(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    sectionId: string,
    body: OrderItemsBody,
  ): Promise<SectionWriteResult> {
    const { ctx } = await this.sectionOf(workspaceId, propertyId, sectionId);
    const ids = new Set(
      ctx.items.filter((item) => item.sectionId === sectionId).map((item) => item.id),
    );
    if (body.itemIds.length !== ids.size || !body.itemIds.every((id) => ids.has(id))) {
      throw new ApiProblem(422, "validation_failed", "List every item of the section once.", {
        fields: { itemIds: ["List every item of the section once"] },
      });
    }
    await this.bump(caller, sectionId, body.revision);
    for (const [position, id] of body.itemIds.entries()) {
      await this.tx.update(guideItem).set({ position }).where(eq(guideItem.id, id));
    }
    return this.finish(workspaceId, propertyId, sectionId);
  }

  async markTopic(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    topicId: string,
    body: TopicMarkBody,
  ): Promise<GuideView> {
    if (!isGuideTopicId(topicId)) throw new ApiProblem(404, "not_found");
    const ctx = await this.views.load(workspaceId, propertyId);
    if (body.mark === null) {
      await this.tx
        .delete(guideTopicMark)
        .where(and(eq(guideTopicMark.guideId, ctx.guide.id), eq(guideTopicMark.topicId, topicId)));
    } else {
      await this.tx
        .insert(guideTopicMark)
        .values({
          guideId: ctx.guide.id,
          workspaceId,
          topicId,
          mark: body.mark,
          setBy: caller.userId,
        })
        .onConflictDoUpdate({
          target: [guideTopicMark.guideId, guideTopicMark.topicId],
          set: { mark: body.mark, setBy: caller.userId, setAt: new Date() },
        });
    }
    await this.recompute(await this.views.load(workspaceId, propertyId));
    return this.get(caller, workspaceId, propertyId);
  }

  // Helpers ------------------------------------------------------------------------------------

  private async sectionOf(workspaceId: string, propertyId: string, sectionId: string) {
    const ctx = await this.views.load(workspaceId, propertyId);
    const section = ctx.sections.find((candidate) => candidate.id === sectionId);
    if (!section)
      throw await this.crossTenant.notFoundInRequest(
        this.tx,
        workspaceId,
        "guide_section",
        sectionId,
      );
    return { ctx, section };
  }

  private async itemOf(workspaceId: string, propertyId: string, itemId: string) {
    const ctx = await this.views.load(workspaceId, propertyId);
    const item = ctx.items.find((candidate) => candidate.id === itemId);
    if (!item)
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "guide_item", itemId);
    return { ctx, item };
  }

  private assertLanguage(ctx: GuideContext, language: Language): void {
    if (!ctx.property.guideLanguages.includes(language)) {
      throw new ApiProblem(422, "validation_failed", "This language is not a guide language.", {
        fields: { language: ["Not a guide language of this property"] },
      });
    }
  }

  private async assertMedia(
    workspaceId: string,
    mediaId: string,
    kind: "image" | "video",
  ): Promise<void> {
    const [row] = await this.tx
      .select({ kind: mediaObject.kind, status: mediaObject.status })
      .from(mediaObject)
      .where(and(eq(mediaObject.id, mediaId), eq(mediaObject.workspaceId, workspaceId)))
      .limit(1);
    if (!row)
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "media_object", mediaId);
    if (row.kind !== kind || row.status === "rejected") {
      throw new ApiProblem(422, "validation_failed", "This media cannot be added here.", {
        fields: { mediaId: ["Wrong kind or rejected"] },
      });
    }
  }

  /** At most 20,000 characters per section and language (FR-010). */
  private assertTextLength(
    ctx: GuideContext,
    sectionId: string,
    language: Language,
    doc: GuideDocument,
    replacing?: string,
  ): void {
    const itemIds = new Set(
      ctx.items
        .filter((item) => item.sectionId === sectionId && item.id !== replacing)
        .map((item) => item.id),
    );
    const used = ctx.texts
      .filter((text) => itemIds.has(text.itemId) && text.language === language)
      .reduce((sum, text) => sum + text.textLength, 0);
    if (used + documentTextLength(doc) > MAX_SECTION_TEXT_LENGTH) {
      throw new ApiProblem(422, "text_too_long", undefined, {
        details: { limit: MAX_SECTION_TEXT_LENGTH },
      });
    }
  }

  /** Code warnings for saved text (FR-023); kinds and positions only, never the value. */
  private warningsOf(doc: GuideDocument | undefined, language: Language): CodeWarning[] {
    if (!doc) return [];
    return docBlockTexts(doc as SegDocument).flatMap((text, blockIndex) => {
      const match = redactRestrictedValues(text).matches[0];
      return match ? [{ kind: match.kind, language, blockIndex }] : [];
    });
  }

  /** Checks and increments a section's revision in one statement (FR-012, research R17). */
  private async bump(
    caller: Caller,
    sectionId: string,
    expected: number,
    changes: Partial<typeof guideSection.$inferInsert> = {},
  ): Promise<void> {
    const rows = await this.tx
      .update(guideSection)
      .set({ ...changes, revision: sql`${guideSection.revision} + 1`, updatedBy: caller.userId })
      .where(and(eq(guideSection.id, sectionId), eq(guideSection.revision, expected)))
      .returning({ id: guideSection.id });
    if (rows.length === 0) {
      const [current] = await this.tx
        .select({ revision: guideSection.revision })
        .from(guideSection)
        .where(eq(guideSection.id, sectionId))
        .limit(1);
      throw new ApiProblem(409, "section_changed", undefined, {
        details: { revision: current?.revision ?? null },
      });
    }
  }

  /**
   * Stores statuses and scores (FR-013, FR-031), and, after a draft change, flags unpublished
   * changes (FR-053).
   */
  private async recompute(
    ctx: GuideContext,
    { draftChanged }: { draftChanged: boolean } = { draftChanged: true },
  ): Promise<{ completeness: number; hasUnpublishedChanges: boolean }> {
    const completeness = this.views.completeness(ctx);
    for (const section of ctx.sections) {
      const score =
        section.kind === "custom" || section.hidden
          ? null
          : (completeness.sections[section.kind]?.score ?? null);
      const status = this.views.statusOf(ctx, section.id);
      if (section.status !== status || section.completeness !== score) {
        await this.tx
          .update(guideSection)
          .set({ status, completeness: score })
          .where(eq(guideSection.id, section.id));
      }
    }
    // A guide that was ever published now differs from what guests read (FR-053).
    const hasUnpublishedChanges = draftChanged
      ? ctx.guide.status !== "draft"
      : ctx.guide.hasUnpublishedChanges;
    if (
      ctx.guide.completeness !== completeness.guide ||
      ctx.guide.hasUnpublishedChanges !== hasUnpublishedChanges
    ) {
      await this.tx
        .update(guide)
        .set({ completeness: completeness.guide, hasUnpublishedChanges })
        .where(eq(guide.id, ctx.guide.id));
    }
    return { completeness: completeness.guide, hasUnpublishedChanges };
  }

  private async finish(
    workspaceId: string,
    propertyId: string,
    sectionId: string,
    itemId?: string,
    warnings: CodeWarning[] = [],
  ): Promise<SectionWriteResult> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const summary = await this.recompute(ctx);
    const after = await this.views.load(workspaceId, propertyId);
    const completeness = this.views.completeness(after);
    const section = after.sections.find((candidate) => candidate.id === sectionId)!;
    const sectionView = await this.views.sectionView(after, section, completeness);
    const item = itemId
      ? sectionView.items.find((candidate) => candidate.id === itemId)
      : undefined;
    return { section: sectionView, guide: summary, warnings, ...(item ? { item } : {}) };
  }
}
