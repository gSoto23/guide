import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type {
  GuidePreview,
  GuideVersionList,
  GuideView,
  MediaView,
  PreviewItem,
  PreviewQuery,
  PublishBody,
  PublishCheck,
  PublishResult,
} from "@guidesk/contracts";
import { documentTextLength, type GuideDocument } from "@guidesk/contracts";
import {
  guide,
  guideItem,
  guideItemText,
  guideSection,
  guideVersion,
  mediaObject,
  property,
  user,
  workspace,
} from "@guidesk/db";
import {
  SNAPSHOT_SCHEMA,
  buildSnapshot,
  canonicalJson,
  checkPublish,
  mainLanguage,
  type DraftSection,
  type GuideLanguage,
  type GuideSnapshot,
  type SegDocument,
  type SnapshotItem,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { GuideViewService, type Caller, type GuideContext } from "./guide-view.service.js";
import { GuidesService } from "./guides.service.js";

/** The number of versions listed and kept per guide (FR-055). */
export const KEPT_VERSIONS = 20;

/**
 * Publishing (feature 003 US3, research R12): the publish check, numbered immutable snapshots,
 * unpublishing, the version list, restoring a version into the draft, and previews as guests will
 * see the guide. Snapshots hold locked fields as references and facts as keys only; their values
 * are resolved at view time (FR-052).
 */
@Injectable()
export class PublishService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly views: GuideViewService,
    private readonly guides: GuidesService,
    private readonly securityLog: SecurityLogService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  /** The draft in the domain's shape. */
  private draftSections(ctx: GuideContext): DraftSection[] {
    return ctx.sections.map((section) => ({
      id: section.id,
      kind: section.kind,
      title: section.title,
      position: section.position,
      hidden: section.hidden,
      items: ctx.items
        .filter((item) => item.sectionId === section.id)
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          position: item.position,
          source: item.source,
          sourceDetail: item.sourceDetail,
          reviewed: item.reviewedAt !== null,
          sourceLanguage: item.sourceLanguage,
          topics: item.topics,
          factKey: item.factKey,
          mediaId: item.mediaId,
          recommendation: item.recommendation,
          texts: Object.fromEntries(
            ctx.texts
              .filter((text) => text.itemId === item.id)
              .map((text) => [
                text.language,
                { doc: text.doc as SegDocument | null, origin: text.origin, state: text.state },
              ]),
          ),
        })),
    }));
  }

  /** The snapshot a publish would store now. */
  private draftSnapshot(ctx: GuideContext): GuideSnapshot {
    return buildSnapshot({
      languages: ctx.property.guideLanguages,
      sections: this.draftSections(ctx),
      sharedBlocks: ctx.sharedBlocks,
      links: ctx.links,
    });
  }

  /** A hash of the snapshot with sorted keys, so a stored (jsonb) copy hashes the same. */
  private hashOf(snapshot: GuideSnapshot): string {
    return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
  }

  private async workspaceActive(workspaceId: string): Promise<boolean> {
    const [row] = await this.tx
      .select({ status: workspace.status })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    return row?.status === "active";
  }

  /** Serializes publishes and restores of one guide, so version numbers never collide. */
  private async lockGuide(propertyId: string): Promise<void> {
    await this.tx.execute(sql`SELECT id FROM guide WHERE property_id = ${propertyId} FOR UPDATE`);
  }

  private checkOf(ctx: GuideContext, workspaceActive: boolean): PublishCheck {
    const result = checkPublish({
      setupReady: ctx.property.setupReady,
      workspaceActive,
      languages: ctx.property.guideLanguages,
      sections: this.draftSections(ctx),
      completeness: this.views.completeness(ctx),
      lockedFields: ctx.lockedFields.map((field) => ({ id: field.id, isSet: field.isSet })),
      codeWarningAcks: Object.fromEntries(ctx.items.map((item) => [item.id, item.codeWarningAck])),
    });
    return {
      ...result,
      warnings: result.warnings as PublishCheck["warnings"],
      revisionHash: this.hashOf(this.draftSnapshot(ctx)),
    };
  }

  /** What blocks publishing, what is left out, and the warnings (FR-049, FR-050). */
  async check(workspaceId: string, propertyId: string): Promise<PublishCheck> {
    const ctx = await this.views.load(workspaceId, propertyId);
    return this.checkOf(ctx, await this.workspaceActive(workspaceId));
  }

  /** Publishes the reviewed draft as version N (FR-051). */
  async publish(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    body: PublishBody,
  ): Promise<PublishResult> {
    await this.lockGuide(propertyId);
    const ctx = await this.views.load(workspaceId, propertyId);
    if (!ctx.property.setupReady) {
      const [row] = await this.tx
        .select({ setupStatus: property.setupStatus })
        .from(property)
        .where(eq(property.id, propertyId))
        .limit(1);
      throw new ApiProblem(409, "not_ready_to_publish", undefined, {
        details: { setupStatus: row?.setupStatus ?? null },
      });
    }
    if (!(await this.workspaceActive(workspaceId))) {
      throw new ApiProblem(409, "workspace_pending_deletion");
    }
    const snapshot = this.draftSnapshot(ctx);
    const hash = this.hashOf(snapshot);
    if (hash !== body.expectedRevisionHash) {
      throw new ApiProblem(409, "section_changed");
    }
    // A repeated publish of the same content keeps the current version (a double tap, a retry).
    if (ctx.guide.status === "published" && ctx.publishedVersion !== null) {
      const current = await this.versionRow(ctx, ctx.publishedVersion);
      if (this.hashOf(current.snapshot) === hash) return { versionNumber: ctx.publishedVersion };
    }
    const [last] = await this.tx
      .select({ number: sql<number>`coalesce(max(${guideVersion.number}), 0)::int` })
      .from(guideVersion)
      .where(eq(guideVersion.guideId, ctx.guide.id));
    const number = (last?.number ?? 0) + 1;
    const now = new Date();
    const [version] = await this.tx
      .insert(guideVersion)
      .values({
        workspaceId,
        guideId: ctx.guide.id,
        number,
        cause: "publish",
        snapshot,
        snapshotSchema: SNAPSHOT_SCHEMA,
        languages: ctx.property.guideLanguages,
        publishedBy: caller.userId,
        publishedAt: now,
      })
      .returning({ id: guideVersion.id });
    await this.tx
      .update(guide)
      .set({
        status: "published",
        publishedVersionId: version!.id,
        hasUnpublishedChanges: false,
        publishedAt: now,
        publishedBy: caller.userId,
      })
      .where(eq(guide.id, ctx.guide.id));
    await this.log("guide.published", caller, workspaceId, ctx.guide.id, propertyId, number);
    return { versionNumber: number };
  }

  /** Stops serving the guide to guests until it is published again (FR-056). */
  async unpublish(caller: Caller, workspaceId: string, propertyId: string): Promise<void> {
    await this.lockGuide(propertyId);
    const ctx = await this.views.load(workspaceId, propertyId);
    if (ctx.guide.status !== "published") return;
    await this.tx
      .update(guide)
      .set({ status: "unpublished", publishedVersionId: null, hasUnpublishedChanges: false })
      .where(eq(guide.id, ctx.guide.id));
    await this.log(
      "guide.unpublished",
      caller,
      workspaceId,
      ctx.guide.id,
      propertyId,
      ctx.publishedVersion,
    );
  }

  /** The latest 20 versions (FR-055). */
  async versions(workspaceId: string, propertyId: string): Promise<GuideVersionList> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const rows = await this.tx
      .select({
        id: guideVersion.id,
        number: guideVersion.number,
        cause: guideVersion.cause,
        publishedAt: guideVersion.publishedAt,
        name: user.name,
      })
      .from(guideVersion)
      .leftJoin(user, eq(user.id, guideVersion.publishedBy))
      .where(eq(guideVersion.guideId, ctx.guide.id))
      .orderBy(desc(guideVersion.number))
      .limit(KEPT_VERSIONS);
    return {
      items: rows.map((row) => ({
        number: row.number,
        cause: row.cause,
        publishedBy: row.name ?? null,
        publishedAt: row.publishedAt.toISOString(),
        current: row.id === ctx.guide.publishedVersionId,
      })),
    };
  }

  private async versionRow(ctx: GuideContext, number: number) {
    const [row] = await this.tx
      .select({ id: guideVersion.id, snapshot: guideVersion.snapshot })
      .from(guideVersion)
      .where(and(eq(guideVersion.guideId, ctx.guide.id), eq(guideVersion.number, number)))
      .limit(1);
    if (!row) throw new ApiProblem(404, "not_found");
    return { id: row.id, snapshot: row.snapshot as GuideSnapshot };
  }

  /**
   * Makes a version the draft without publishing it (FR-055, research R12): its sections and
   * reviewed items come back in order, items keep their IDs and source labels where they still
   * exist, sections the version did not show are hidden (custom ones removed), and the draft's
   * other items are removed.
   */
  async restore(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    number: number,
  ): Promise<GuideView> {
    await this.lockGuide(propertyId);
    const ctx = await this.views.load(workspaceId, propertyId);
    const { snapshot } = await this.versionRow(ctx, number);
    const now = new Date();
    const keptSections = new Set<string>();
    const keptItems = new Set<string>();

    for (const [index, snapSection] of snapshot.sections.entries()) {
      const existing =
        ctx.sections.find((section) => section.id === snapSection.id) ??
        (snapSection.kind === "custom"
          ? undefined
          : ctx.sections.find((section) => section.kind === snapSection.kind));
      let sectionId: string;
      if (existing) {
        sectionId = existing.id;
        await this.tx
          .update(guideSection)
          .set({
            position: index,
            hidden: false,
            ...(snapSection.kind === "custom" ? { title: snapSection.title ?? null } : {}),
            revision: sql`${guideSection.revision} + 1`,
            updatedBy: caller.userId,
          })
          .where(eq(guideSection.id, existing.id));
      } else {
        const [created] = await this.tx
          .insert(guideSection)
          .values({
            id: snapSection.id,
            workspaceId,
            guideId: ctx.guide.id,
            kind: snapSection.kind,
            title: snapSection.kind === "custom" ? (snapSection.title ?? null) : null,
            position: index,
            updatedBy: caller.userId,
          })
          .returning({ id: guideSection.id });
        sectionId = created!.id;
      }
      keptSections.add(sectionId);

      const own = snapSection.items.filter((item) => !item.sharedBlockId);
      for (const [position, snapItem] of own.entries()) {
        await this.restoreItem(ctx, caller, workspaceId, sectionId, position, snapItem, now);
        keptItems.add(snapItem.id);
      }
    }

    // Sections the version did not show: default ones are hidden, custom ones removed.
    let position = snapshot.sections.length;
    for (const section of ctx.sections) {
      if (keptSections.has(section.id)) continue;
      if (section.kind === "custom") {
        await this.tx.delete(guideSection).where(eq(guideSection.id, section.id));
        continue;
      }
      await this.tx
        .update(guideSection)
        .set({
          hidden: true,
          position,
          revision: sql`${guideSection.revision} + 1`,
          updatedBy: caller.userId,
        })
        .where(eq(guideSection.id, section.id));
      position += 1;
    }
    const remainingSections = [...keptSections];
    if (remainingSections.length > 0) {
      const stale = this.tx
        .delete(guideItem)
        .where(
          keptItems.size > 0
            ? and(
                inArray(guideItem.sectionId, remainingSections),
                notInArray(guideItem.id, [...keptItems]),
              )
            : inArray(guideItem.sectionId, remainingSections),
        );
      await stale;
    }

    const after = await this.views.load(workspaceId, propertyId);
    await this.guides.recompute(after);
    await this.log("guide.version_restored", caller, workspaceId, ctx.guide.id, propertyId, number);
    return this.views.view(await this.views.load(workspaceId, propertyId), caller);
  }

  private async restoreItem(
    ctx: GuideContext,
    caller: Caller,
    workspaceId: string,
    sectionId: string,
    position: number,
    snapItem: SnapshotItem,
    now: Date,
  ): Promise<void> {
    const existing = ctx.items.find((item) => item.id === snapItem.id);
    const fields = {
      sectionId,
      kind: snapItem.kind,
      position,
      sourceLanguage: snapItem.sourceLanguage,
      factKey: snapItem.factKey ?? null,
      mediaId: snapItem.mediaId ?? null,
      recommendation: snapItem.recommendation ?? null,
      updatedBy: caller.userId,
    };
    if (existing) {
      await this.tx
        .update(guideItem)
        .set({
          ...fields,
          reviewedAt: existing.reviewedAt ?? now,
          reviewedBy: existing.reviewedAt ? existing.reviewedBy : caller.userId,
        })
        .where(eq(guideItem.id, existing.id));
    } else {
      await this.tx.insert(guideItem).values({
        id: snapItem.id,
        workspaceId,
        ...fields,
        source: "host",
        reviewedAt: now,
        reviewedBy: caller.userId,
      });
    }
    const languages = Object.keys(snapItem.texts) as GuideLanguage[];
    await this.tx
      .delete(guideItemText)
      .where(
        languages.length > 0
          ? and(
              eq(guideItemText.itemId, snapItem.id),
              notInArray(guideItemText.language, languages),
            )
          : eq(guideItemText.itemId, snapItem.id),
      );
    for (const language of languages) {
      const doc = snapItem.texts[language] as GuideDocument;
      const current = ctx.texts.find(
        (text) => text.itemId === snapItem.id && text.language === language,
      );
      if (current && JSON.stringify(current.doc) === JSON.stringify(doc)) {
        if (current.state !== "current") {
          await this.tx
            .update(guideItemText)
            .set({ state: "current", pendingReason: null })
            .where(
              and(eq(guideItemText.itemId, snapItem.id), eq(guideItemText.language, language)),
            );
        }
        continue;
      }
      const origin =
        language === snapItem.sourceLanguage
          ? ("source" as const)
          : current?.origin === "reviewed"
            ? ("reviewed" as const)
            : ("machine" as const);
      await this.tx
        .insert(guideItemText)
        .values({
          itemId: snapItem.id,
          language,
          workspaceId,
          doc,
          textLength: documentTextLength(doc),
          origin,
          state: "current",
        })
        .onConflictDoUpdate({
          target: [guideItemText.itemId, guideItemText.language],
          set: {
            doc,
            textLength: documentTextLength(doc),
            origin,
            state: "current",
            sourceHash: null,
            pendingReason: null,
          },
        });
    }
  }

  /** The guide as guests will see it, in one language, locked fields as placeholders (FR-054). */
  async preview(
    workspaceId: string,
    propertyId: string,
    query: PreviewQuery,
  ): Promise<GuidePreview> {
    const ctx = await this.views.load(workspaceId, propertyId);
    let snapshot: GuideSnapshot;
    let source: GuidePreview["source"];
    let versionNumber: number | null = null;
    if (query.source === "draft") {
      snapshot = this.draftSnapshot(ctx);
      source = "draft";
    } else if (query.source === "published") {
      if (!ctx.guide.publishedVersionId || ctx.publishedVersion === null) {
        throw new ApiProblem(404, "not_found");
      }
      snapshot = (await this.versionRow(ctx, ctx.publishedVersion)).snapshot;
      source = "published";
      versionNumber = ctx.publishedVersion;
    } else {
      versionNumber = Number(query.source);
      snapshot = (await this.versionRow(ctx, versionNumber)).snapshot;
      source = "version";
    }
    const languages = snapshot.languages;
    const language =
      query.lang && languages.includes(query.lang) ? query.lang : mainLanguage(languages);

    const mediaIds = snapshot.sections.flatMap((section) =>
      section.items.map((item) => item.mediaId).filter((id): id is string => !!id),
    );
    const mediaRows = mediaIds.length
      ? await this.tx.select().from(mediaObject).where(inArray(mediaObject.id, mediaIds))
      : [];
    const media = new Map<string, MediaView>();
    for (const row of mediaRows) media.set(row.id, await this.views.mediaViewOf(ctx, row));

    const factValue = (key: NonNullable<SnapshotItem["factKey"]>): string | null => {
      switch (key) {
        case "check_in_time":
          return ctx.property.checkInTime;
        case "checkout_time":
          return ctx.property.checkoutTime;
        case "max_guests":
          return ctx.property.maxGuests === null ? null : String(ctx.property.maxGuests);
        case "address":
          return ctx.property.address;
      }
    };

    return {
      source,
      versionNumber,
      language,
      languages,
      propertyName: ctx.property.name,
      sections: snapshot.sections.map((section) => ({
        id: section.id,
        kind: section.kind,
        title:
          section.kind === "custom"
            ? (section.title?.[language] ?? Object.values(section.title ?? {})[0] ?? null)
            : null,
        items: section.items.map((item): PreviewItem => ({
          id: item.id,
          kind: item.kind,
          shared: Boolean(item.sharedBlockId),
          doc: (item.texts[language] ??
            item.texts[item.sourceLanguage] ??
            null) as GuideDocument | null,
          docLanguage: item.texts[language] ? language : item.sourceLanguage,
          ...(item.factKey ? { fact: { key: item.factKey, value: factValue(item.factKey) } } : {}),
          ...(item.mediaId ? { media: media.get(item.mediaId) ?? null } : {}),
          ...(item.recommendation
            ? { recommendation: item.recommendation as PreviewItem["recommendation"] }
            : {}),
        })),
      })),
      lockedFields: ctx.lockedFields.map((field) => ({
        id: field.id,
        kind: field.kind,
        label: field.label,
      })),
    };
  }

  private async log(
    type: "guide.published" | "guide.unpublished" | "guide.version_restored",
    caller: Caller,
    workspaceId: string,
    guideId: string,
    propertyId: string,
    versionNumber: number | null,
  ): Promise<void> {
    await this.securityLog.record({
      type,
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "guide",
      targetId: guideId,
      metadata: { propertyId, versionNumber },
    });
  }
}
