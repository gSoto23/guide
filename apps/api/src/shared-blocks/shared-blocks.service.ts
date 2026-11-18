import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type {
  CreateBlockItemBody,
  CreateSharedBlockBody,
  SharedBlockList,
  SharedBlockProperties,
  SharedBlockPublishResult,
  SharedBlockSummary,
  SharedBlockView,
  UpdateBlockItemBody,
  UpdateSharedBlockBody,
} from "@guidesk/contracts";
import { documentTextLength, type GuideDocument } from "@guidesk/contracts";
import {
  guide,
  guideItem,
  guideItemText,
  guideSharedLink,
  mediaObject,
  property,
  sharedBlock,
} from "@guidesk/db";
import {
  JOB_QUEUES,
  MAX_SHARED_BLOCKS,
  snapshotItem,
  TRANSLATE_DEBOUNCE_SECONDS,
  type DraftItem,
  type GuideTranslateJob,
  type SegDocument,
  type SharedBlockPublishJob,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { GuideViewService, type Caller } from "../guides/guide-view.service.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";

type BlockRow = typeof sharedBlock.$inferSelect;
type Language = "es" | "en";

/** Shared blocks are written in, and published to, both guide languages (research R14). */
const BLOCK_LANGUAGES: readonly Language[] = ["es", "en"];

/**
 * Workspace shared content (feature 003 US7, research R14, FR-057 to FR-062): blocks with their own
 * items and draft, a published snapshot with a revision, and the `shared-block.publish` fan-out
 * that updates every inheriting published guide. Locked-field references are refused in blocks
 * (the contract's schema), because a block belongs to no property.
 */
@Injectable()
export class SharedBlocksService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly views: GuideViewService,
    private readonly jobs: JobQueueService,
    private readonly securityLog: SecurityLogService,
    private readonly crossTenant: CrossTenantService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  private async counts(workspaceId: string) {
    const rows = await this.tx
      .select({ blockId: guideSharedLink.sharedBlockId, mode: guideSharedLink.mode })
      .from(guideSharedLink)
      .innerJoin(guide, eq(guide.id, guideSharedLink.guideId))
      .innerJoin(property, eq(property.id, guide.propertyId))
      .where(and(eq(guideSharedLink.workspaceId, workspaceId), eq(property.status, "active")));
    const [{ total } = { total: 0 }] = await this.tx
      .select({ total: sql<number>`count(*)::int` })
      .from(property)
      .where(and(eq(property.workspaceId, workspaceId), eq(property.status, "active")));
    return { rows, total };
  }

  private summaryOf(
    row: BlockRow,
    counts: { rows: { blockId: string; mode: string }[]; total: number },
  ): SharedBlockSummary {
    const own = counts.rows.filter((link) => link.blockId === row.id);
    const override = own.filter((link) => link.mode === "override").length;
    const exclude = own.filter((link) => link.mode === "exclude").length;
    return {
      id: row.id,
      name: row.name,
      sectionKind: row.sectionKind,
      position: row.position,
      status: row.status,
      revision: row.revision,
      hasUnpublishedChanges: row.hasUnpublishedChanges,
      publishedRevision: row.publishedRevision,
      counts: { inherit: Math.max(0, counts.total - override - exclude), override, exclude },
    };
  }

  async list(workspaceId: string): Promise<SharedBlockList> {
    const rows = await this.tx
      .select()
      .from(sharedBlock)
      .where(eq(sharedBlock.workspaceId, workspaceId))
      .orderBy(asc(sharedBlock.sectionKind), asc(sharedBlock.position), asc(sharedBlock.createdAt));
    const counts = await this.counts(workspaceId);
    return { items: rows.map((row) => this.summaryOf(row, counts)), limit: MAX_SHARED_BLOCKS };
  }

  async create(
    caller: Caller,
    workspaceId: string,
    body: CreateSharedBlockBody,
  ): Promise<SharedBlockView> {
    const [{ count } = { count: 0 }] = await this.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(sharedBlock)
      .where(eq(sharedBlock.workspaceId, workspaceId));
    if (count >= MAX_SHARED_BLOCKS) {
      throw new ApiProblem(422, "shared_block_limit", undefined, {
        details: { limit: MAX_SHARED_BLOCKS },
      });
    }
    const [{ position } = { position: 0 }] = await this.tx
      .select({ position: sql<number>`coalesce(max(${sharedBlock.position}) + 1, 0)::int` })
      .from(sharedBlock)
      .where(
        and(
          eq(sharedBlock.workspaceId, workspaceId),
          eq(sharedBlock.sectionKind, body.sectionKind),
        ),
      );
    const [row] = await this.tx
      .insert(sharedBlock)
      .values({
        workspaceId,
        sectionKind: body.sectionKind,
        name: body.name,
        position,
        createdBy: caller.userId,
      })
      .returning();
    return this.viewOf(caller, workspaceId, row!);
  }

  async get(caller: Caller, workspaceId: string, blockId: string): Promise<SharedBlockView> {
    return this.viewOf(caller, workspaceId, await this.load(workspaceId, blockId));
  }

  async update(
    caller: Caller,
    workspaceId: string,
    blockId: string,
    body: UpdateSharedBlockBody,
  ): Promise<SharedBlockView> {
    const row = await this.load(workspaceId, blockId);
    await this.bump(row, body.revision, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.position !== undefined ? { position: body.position } : {}),
    });
    return this.get(caller, workspaceId, blockId);
  }

  async createItem(
    caller: Caller,
    workspaceId: string,
    blockId: string,
    body: CreateBlockItemBody,
  ): Promise<SharedBlockView> {
    const row = await this.load(workspaceId, blockId);
    if (body.mediaId) await this.assertMedia(workspaceId, body.mediaId, body.kind);
    await this.bump(row, body.revision, { hasUnpublishedChanges: row.status === "published" });
    const [{ position } = { position: 0 }] = await this.tx
      .select({ position: sql<number>`coalesce(max(${guideItem.position}) + 1, 0)::int` })
      .from(guideItem)
      .where(eq(guideItem.sharedBlockId, row.id));
    const now = new Date();
    const [item] = await this.tx
      .insert(guideItem)
      .values({
        workspaceId,
        sharedBlockId: row.id,
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
    if (body.doc)
      await this.writeText(workspaceId, row.id, item!.id, body.language, body.doc, true);
    return this.get(caller, workspaceId, blockId);
  }

  async updateItem(
    caller: Caller,
    workspaceId: string,
    itemId: string,
    body: UpdateBlockItemBody,
  ): Promise<SharedBlockView> {
    const { row, item } = await this.itemOf(workspaceId, itemId);
    await this.bump(row, body.revision, { hasUnpublishedChanges: row.status === "published" });
    if (body.doc) {
      await this.writeText(
        workspaceId,
        row.id,
        item.id,
        body.language,
        body.doc,
        body.language === item.sourceLanguage,
      );
    }
    await this.tx
      .update(guideItem)
      .set({
        reviewedAt: new Date(),
        reviewedBy: caller.userId,
        updatedBy: caller.userId,
        ...(body.recommendation ? { recommendation: body.recommendation } : {}),
      })
      .where(eq(guideItem.id, item.id));
    return this.get(caller, workspaceId, row.id);
  }

  async deleteItem(
    caller: Caller,
    workspaceId: string,
    itemId: string,
    revision: number,
  ): Promise<SharedBlockView> {
    const { row, item } = await this.itemOf(workspaceId, itemId);
    await this.bump(row, revision, { hasUnpublishedChanges: row.status === "published" });
    await this.tx.delete(guideItem).where(eq(guideItem.id, item.id));
    return this.get(caller, workspaceId, row.id);
  }

  async approveItem(
    caller: Caller,
    workspaceId: string,
    itemId: string,
    revision: number,
  ): Promise<SharedBlockView> {
    const { row, item } = await this.itemOf(workspaceId, itemId);
    await this.bump(row, revision, { hasUnpublishedChanges: row.status === "published" });
    await this.tx
      .update(guideItem)
      .set({ reviewedAt: new Date(), reviewedBy: caller.userId })
      .where(eq(guideItem.id, item.id));
    return this.get(caller, workspaceId, row.id);
  }

  /** Publishes the block and updates every inheriting published guide (FR-060). */
  async publish(
    caller: Caller,
    workspaceId: string,
    blockId: string,
  ): Promise<SharedBlockPublishResult> {
    const row = await this.load(workspaceId, blockId);
    const items = await this.tx
      .select()
      .from(guideItem)
      .where(eq(guideItem.sharedBlockId, row.id))
      .orderBy(asc(guideItem.position));
    const texts = items.length
      ? await this.tx
          .select()
          .from(guideItemText)
          .where(
            inArray(
              guideItemText.itemId,
              items.map((item) => item.id),
            ),
          )
      : [];
    const snapshotItems = items
      .filter((item) => item.reviewedAt !== null)
      .map((item) => {
        const draft: DraftItem = {
          id: item.id,
          kind: item.kind,
          position: item.position,
          source: item.source,
          reviewed: true,
          sourceLanguage: item.sourceLanguage,
          topics: item.topics,
          mediaId: item.mediaId,
          recommendation: item.recommendation,
          texts: Object.fromEntries(
            texts
              .filter((text) => text.itemId === item.id)
              .map((text) => [
                text.language,
                { doc: text.doc as SegDocument | null, origin: text.origin, state: text.state },
              ]),
          ),
        };
        return snapshotItem(draft, BLOCK_LANGUAGES);
      });
    const now = new Date();
    await this.tx
      .update(sharedBlock)
      .set({
        status: "published",
        hasUnpublishedChanges: false,
        publishedRevision: row.revision,
        publishedSnapshot: { items: snapshotItems },
        publishedAt: now,
        publishedBy: caller.userId,
      })
      .where(eq(sharedBlock.id, row.id));
    const guidesToUpdate = await this.inheritingPublishedGuides(workspaceId, row.id);
    await this.jobs.send(
      JOB_QUEUES.sharedBlockPublish,
      { workspaceId, sharedBlockId: row.id, change: "published" } satisfies SharedBlockPublishJob,
      { retryLimit: 3, retryBackoff: true },
    );
    await this.securityLog.record({
      type: "shared_block.published",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "shared_block",
      targetId: row.id,
      metadata: {
        sharedBlockId: row.id,
        sectionKind: row.sectionKind,
        guidesUpdated: guidesToUpdate,
      },
    });
    return { publishedRevision: row.revision, guidesToUpdate };
  }

  /** Removes the block from every draft at once and from published guides by the fan-out. */
  async remove(caller: Caller, workspaceId: string, blockId: string): Promise<void> {
    const row = await this.load(workspaceId, blockId);
    const guidesToUpdate = await this.inheritingPublishedGuides(workspaceId, row.id);
    await this.tx.delete(sharedBlock).where(eq(sharedBlock.id, row.id));
    await this.jobs.send(
      JOB_QUEUES.sharedBlockPublish,
      { workspaceId, sharedBlockId: row.id, change: "deleted" } satisfies SharedBlockPublishJob,
      { retryLimit: 3, retryBackoff: true },
    );
    await this.securityLog.record({
      type: "shared_block.deleted",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "shared_block",
      targetId: row.id,
      metadata: {
        sharedBlockId: row.id,
        sectionKind: row.sectionKind,
        guidesUpdated: guidesToUpdate,
      },
    });
  }

  /** Which properties inherit, override (and whether they are behind), or exclude it (FR-062). */
  async properties(workspaceId: string, blockId: string): Promise<SharedBlockProperties> {
    const row = await this.load(workspaceId, blockId);
    const rows = await this.tx
      .select({
        propertyId: property.id,
        name: property.name,
        mode: guideSharedLink.mode,
        basedOnRevision: guideSharedLink.basedOnRevision,
      })
      .from(property)
      .innerJoin(guide, eq(guide.propertyId, property.id))
      .leftJoin(
        guideSharedLink,
        and(eq(guideSharedLink.guideId, guide.id), eq(guideSharedLink.sharedBlockId, row.id)),
      )
      .where(and(eq(property.workspaceId, workspaceId), eq(property.status, "active")))
      .orderBy(asc(property.name));
    return {
      inherit: rows
        .filter((entry) => !entry.mode)
        .map((entry) => ({ propertyId: entry.propertyId, name: entry.name })),
      override: rows
        .filter((entry) => entry.mode === "override")
        .map((entry) => ({
          propertyId: entry.propertyId,
          name: entry.name,
          behind:
            row.publishedRevision !== null &&
            entry.basedOnRevision !== null &&
            entry.basedOnRevision < row.publishedRevision,
        })),
      exclude: rows
        .filter((entry) => entry.mode === "exclude")
        .map((entry) => ({ propertyId: entry.propertyId, name: entry.name })),
    };
  }

  private async inheritingPublishedGuides(workspaceId: string, blockId: string): Promise<number> {
    const [{ count } = { count: 0 }] = await this.tx
      .select({ count: sql<number>`count(*)::int` })
      .from(guide)
      .where(
        and(
          eq(guide.workspaceId, workspaceId),
          eq(guide.status, "published"),
          isNotNull(guide.publishedVersionId),
          sql`NOT EXISTS (SELECT 1 FROM guide_shared_link l WHERE l.guide_id = ${guide.id} AND l.shared_block_id = ${blockId})`,
        ),
      );
    return count;
  }

  /** A block text: the source, or a reviewed translation; other languages follow the source. */
  private async writeText(
    workspaceId: string,
    blockId: string,
    itemId: string,
    language: Language,
    doc: GuideDocument,
    isSource: boolean,
  ): Promise<void> {
    const values = {
      doc,
      textLength: documentTextLength(doc),
      origin: isSource ? ("source" as const) : ("reviewed" as const),
      state: "current" as const,
      pendingReason: null,
    };
    await this.tx
      .insert(guideItemText)
      .values({ itemId, language, workspaceId, ...values })
      .onConflictDoUpdate({ target: [guideItemText.itemId, guideItemText.language], set: values });
    if (!isSource) return;
    for (const other of BLOCK_LANGUAGES.filter((candidate) => candidate !== language)) {
      await this.tx
        .insert(guideItemText)
        .values({
          itemId,
          language: other,
          workspaceId,
          doc: null,
          origin: "machine",
          state: "stale",
        })
        .onConflictDoUpdate({
          target: [guideItemText.itemId, guideItemText.language],
          set: {
            state: sql`CASE WHEN ${guideItemText.origin} = 'reviewed' THEN 'out_of_date' ELSE 'stale' END`,
            pendingReason: null,
          },
        });
      // Blocks are translated once per workspace, like sections (research R7).
      await this.jobs.send(
        JOB_QUEUES.guideTranslate,
        { workspaceId, sharedBlockId: blockId, language: other } satisfies GuideTranslateJob,
        {
          startAfter: TRANSLATE_DEBOUNCE_SECONDS,
          singletonKey: `${blockId}:${other}`,
          retryLimit: 3,
          retryBackoff: true,
        },
      );
    }
  }

  private async bump(
    row: BlockRow,
    expected: number,
    changes: Partial<typeof sharedBlock.$inferInsert> = {},
  ): Promise<void> {
    const updated = await this.tx
      .update(sharedBlock)
      .set({ ...changes, revision: sql`${sharedBlock.revision} + 1` })
      .where(and(eq(sharedBlock.id, row.id), eq(sharedBlock.revision, expected)))
      .returning({ id: sharedBlock.id });
    if (updated.length === 0) {
      throw new ApiProblem(409, "section_changed", undefined, {
        details: { revision: row.revision },
      });
    }
  }

  private async assertMedia(
    workspaceId: string,
    mediaId: string,
    kind: CreateBlockItemBody["kind"],
  ): Promise<void> {
    const [row] = await this.tx
      .select({ kind: mediaObject.kind, status: mediaObject.status })
      .from(mediaObject)
      .where(and(eq(mediaObject.id, mediaId), eq(mediaObject.workspaceId, workspaceId)))
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "media_object", mediaId);
    }
    if (row.kind !== kind || row.status === "rejected") {
      throw new ApiProblem(422, "validation_failed", "This media cannot be added here.", {
        fields: { mediaId: ["Wrong kind or rejected"] },
      });
    }
  }

  private async load(workspaceId: string, blockId: string): Promise<BlockRow> {
    const [row] = await this.tx
      .select()
      .from(sharedBlock)
      .where(and(eq(sharedBlock.id, blockId), eq(sharedBlock.workspaceId, workspaceId)))
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "shared_block", blockId);
    }
    return row;
  }

  private async itemOf(workspaceId: string, itemId: string) {
    const [item] = await this.tx
      .select()
      .from(guideItem)
      .where(and(eq(guideItem.id, itemId), eq(guideItem.workspaceId, workspaceId)))
      .limit(1);
    if (!item?.sharedBlockId) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "guide_item", itemId);
    }
    return { row: await this.load(workspaceId, item.sharedBlockId), item };
  }

  private async viewOf(
    caller: Caller,
    workspaceId: string,
    row: BlockRow,
  ): Promise<SharedBlockView> {
    const items = await this.tx
      .select()
      .from(guideItem)
      .where(eq(guideItem.sharedBlockId, row.id))
      .orderBy(asc(guideItem.position));
    const ids = items.map((item) => item.id);
    const texts = ids.length
      ? await this.tx.select().from(guideItemText).where(inArray(guideItemText.itemId, ids))
      : [];
    const mediaIds = items.map((item) => item.mediaId).filter((id): id is string => !!id);
    const media = mediaIds.length
      ? await this.tx.select().from(mediaObject).where(inArray(mediaObject.id, mediaIds))
      : [];
    const counts = await this.counts(workspaceId);
    return {
      ...this.summaryOf(row, counts),
      items: await Promise.all(items.map((item) => this.views.itemView({ texts, media }, item))),
      languages: [...BLOCK_LANGUAGES],
      canEdit: caller.role === "owner" || caller.role === "admin",
    };
  }
}
