import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type {
  GuideView,
  ItemText,
  ItemView,
  LockedFieldView,
  MediaView,
  Recommendation,
  SectionView,
} from "@guidesk/contracts";
import {
  guide,
  guideItem,
  guideItemText,
  guideSection,
  guideSharedLink,
  guideTopicMark,
  guideVersion,
  mediaObject,
  property,
  restrictedValuePublic,
  sharedBlock,
  type Transaction,
} from "@guidesk/db";
import {
  computeCompleteness,
  docPlainText,
  inheritedBlocks,
  mainLanguage,
  sectionStatus,
  type CompletenessResult,
  type CoverageSection,
  type GuideLanguage,
  type Role,
  type SegDocument,
  type SharedBlockSnapshot,
  type SharedLinkMode,
} from "@guidesk/domain";
import type { MediaStoragePort } from "@guidesk/integrations";
import { RequestDb } from "../database/request-db.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { MEDIA_STORAGE } from "../uploads/media.provider.js";

export interface Caller {
  userId: string;
  role: Role;
}

type GuideRow = typeof guide.$inferSelect;
type SectionRow = typeof guideSection.$inferSelect;
type ItemRow = typeof guideItem.$inferSelect;
type TextRow = typeof guideItemText.$inferSelect;
type MediaRow = typeof mediaObject.$inferSelect;

/** Everything a guide screen or a write needs, loaded once inside the request's transaction. */
export interface GuideContext {
  workspaceId: string;
  property: {
    id: string;
    name: string;
    setupReady: boolean;
    guideLanguages: GuideLanguage[];
    checkInTime: string | null;
    checkoutTime: string | null;
    maxGuests: number | null;
    address: string | null;
  };
  guide: GuideRow;
  sections: SectionRow[];
  items: ItemRow[];
  texts: TextRow[];
  media: MediaRow[];
  lockedFields: (typeof restrictedValuePublic.$inferSelect)[];
  marks: Record<string, "covered" | "not_applicable">;
  sharedBlocks: SharedBlockSnapshot[];
  links: Record<string, SharedLinkMode>;
  /** Names of the published shared blocks, and the revision each override was copied from. */
  blockNames: Record<string, string>;
  linkRevisions: Record<string, number | null>;
  publishedVersion: number | null;
}

const MEDIA_TYPES: Record<string, string> = { image: "image/webp", video: "video/mp4" };

function hhmm(time: string | null): string | null {
  return time ? time.slice(0, 5) : null;
}

/**
 * Loads and shapes guides (feature 003 contract "Guide and sections"): the read model the portal
 * shows, the completeness score (FR-030), section statuses (FR-013), and locked fields without
 * their values (FR-016, FR-063).
 */
@Injectable()
export class GuideViewService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    @Inject(MEDIA_STORAGE) private readonly media: MediaStoragePort,
  ) {}

  /** Loads a property's guide; `404` for removed properties and other workspaces. */
  async load(workspaceId: string, propertyId: string): Promise<GuideContext> {
    const tx = this.requestDb.current();
    const [prop] = await tx
      .select({
        id: property.id,
        name: property.name,
        setupStatus: property.setupStatus,
        guideLanguages: property.guideLanguages,
        checkInTime: property.checkInTime,
        checkoutTime: property.checkoutTime,
        maxGuests: property.maxGuests,
        addressLine1: property.addressLine1,
        addressUnit: property.addressUnit,
        city: property.city,
      })
      .from(property)
      .where(
        and(
          eq(property.id, propertyId),
          eq(property.workspaceId, workspaceId),
          eq(property.status, "active"),
        ),
      )
      .limit(1);
    if (!prop)
      throw await this.crossTenant.notFoundInRequest(tx, workspaceId, "property", propertyId);
    const [row] = await tx.select().from(guide).where(eq(guide.propertyId, propertyId)).limit(1);
    if (!row)
      throw await this.crossTenant.notFoundInRequest(tx, workspaceId, "property", propertyId);
    return this.loadRest(tx, workspaceId, prop, row);
  }

  private async loadRest(
    tx: Transaction,
    workspaceId: string,
    prop: {
      id: string;
      name: string;
      setupStatus: string;
      guideLanguages: GuideLanguage[];
      checkInTime: string | null;
      checkoutTime: string | null;
      maxGuests: number | null;
      addressLine1: string | null;
      addressUnit: string | null;
      city: string | null;
    },
    row: GuideRow,
  ): Promise<GuideContext> {
    const sections = await tx
      .select()
      .from(guideSection)
      .where(eq(guideSection.guideId, row.id))
      .orderBy(asc(guideSection.position));
    const sectionIds = sections.map((section) => section.id);
    const items = sectionIds.length
      ? await tx
          .select()
          .from(guideItem)
          .where(inArray(guideItem.sectionId, sectionIds))
          .orderBy(asc(guideItem.position))
      : [];
    const itemIds = items.map((item) => item.id);
    const texts = itemIds.length
      ? await tx.select().from(guideItemText).where(inArray(guideItemText.itemId, itemIds))
      : [];
    const mediaIds = items.map((item) => item.mediaId).filter((id): id is string => !!id);
    const media = mediaIds.length
      ? await tx.select().from(mediaObject).where(inArray(mediaObject.id, mediaIds))
      : [];
    const lockedFields = await tx
      .select()
      .from(restrictedValuePublic)
      .where(eq(restrictedValuePublic.propertyId, prop.id))
      .orderBy(asc(restrictedValuePublic.createdAt));
    const markRows = await tx
      .select({ topicId: guideTopicMark.topicId, mark: guideTopicMark.mark })
      .from(guideTopicMark)
      .where(eq(guideTopicMark.guideId, row.id));
    const blockRows = await tx
      .select({
        id: sharedBlock.id,
        name: sharedBlock.name,
        sectionKind: sharedBlock.sectionKind,
        position: sharedBlock.position,
        revision: sharedBlock.publishedRevision,
        snapshot: sharedBlock.publishedSnapshot,
      })
      .from(sharedBlock)
      .where(
        and(eq(sharedBlock.workspaceId, workspaceId), isNotNull(sharedBlock.publishedSnapshot)),
      );
    const linkRows = await tx
      .select({
        blockId: guideSharedLink.sharedBlockId,
        mode: guideSharedLink.mode,
        basedOnRevision: guideSharedLink.basedOnRevision,
      })
      .from(guideSharedLink)
      .where(eq(guideSharedLink.guideId, row.id));
    let publishedVersion: number | null = null;
    if (row.publishedVersionId) {
      const [version] = await tx
        .select({ number: guideVersion.number })
        .from(guideVersion)
        .where(eq(guideVersion.id, row.publishedVersionId))
        .limit(1);
      publishedVersion = version?.number ?? null;
    }
    const address = [prop.addressLine1, prop.addressUnit, prop.city].filter(Boolean).join(", ");
    return {
      workspaceId,
      property: {
        id: prop.id,
        name: prop.name,
        setupReady: prop.setupStatus === "ready",
        guideLanguages: prop.guideLanguages,
        checkInTime: hhmm(prop.checkInTime),
        checkoutTime: hhmm(prop.checkoutTime),
        maxGuests: prop.maxGuests,
        address: address || null,
      },
      guide: row,
      sections,
      items,
      texts,
      media,
      lockedFields,
      marks: Object.fromEntries(markRows.map((mark) => [mark.topicId, mark.mark])),
      sharedBlocks: blockRows.map((block) => ({
        blockId: block.id,
        sectionKind: block.sectionKind,
        position: block.position,
        revision: block.revision ?? 0,
        items: (block.snapshot as { items?: SharedBlockSnapshot["items"] } | null)?.items ?? [],
      })),
      links: Object.fromEntries(linkRows.map((link) => [link.blockId, link.mode])),
      blockNames: Object.fromEntries(blockRows.map((block) => [block.id, block.name])),
      linkRevisions: Object.fromEntries(
        linkRows.map((link) => [link.blockId, link.basedOnRevision]),
      ),
      publishedVersion,
    };
  }

  /** The completeness of a loaded guide (FR-030), with inherited shared blocks (FR-062). */
  completeness(ctx: GuideContext): CompletenessResult {
    const textsOf = (itemId: string) =>
      ctx.texts
        .filter((text) => text.itemId === itemId && text.doc)
        .map((text) => docPlainText(text.doc as SegDocument));
    const coverage: CoverageSection[] = ctx.sections.map((section) => {
      const own = ctx.items
        .filter((item) => item.sectionId === section.id)
        .map((item) => ({
          kind: item.kind,
          texts: [...textsOf(item.id), item.recommendation?.name ?? ""].filter(Boolean),
          topics: item.topics,
          personalTip: item.recommendation?.personalTip === true,
        }));
      const inherited = inheritedBlocks(section.kind, ctx.sharedBlocks, ctx.links).flatMap(
        (block) =>
          block.items.map((item) => ({
            kind: item.kind,
            texts: Object.values(item.texts).map((doc) => docPlainText(doc)),
            topics: [],
            personalTip: item.recommendation?.personalTip === true,
          })),
      );
      return { kind: section.kind, hidden: section.hidden, items: [...own, ...inherited] };
    });
    return computeCompleteness({
      sections: coverage,
      setLockedFieldKinds: ctx.lockedFields
        .filter((field) => field.isSet)
        .map((field) => field.kind),
      facts: {
        check_in_time: ctx.property.checkInTime !== null,
        checkout_time: ctx.property.checkoutTime !== null,
        max_guests: ctx.property.maxGuests !== null,
        address: ctx.property.address !== null,
      },
      marks: ctx.marks,
    });
  }

  /** A section's status from its own items and their translations (FR-013). */
  statusOf(ctx: GuideContext, sectionId: string) {
    return sectionStatus(
      ctx.items
        .filter((item) => item.sectionId === sectionId)
        .map((item) => ({
          kind: item.kind,
          reviewed: item.reviewedAt !== null,
          hasOutOfDateTranslation: ctx.texts.some(
            (text) => text.itemId === item.id && text.state === "out_of_date",
          ),
        })),
    );
  }

  /** A media object as the portal sees it, with signed URLs when ready. */
  async mediaViewOf(_ctx: GuideContext, row: MediaRow): Promise<MediaView> {
    return this.mediaView(row);
  }

  private async mediaView(row: MediaRow): Promise<MediaView> {
    const urls: MediaView["urls"] = {};
    if (row.status === "ready") {
      for (const [name, variant] of Object.entries(row.variants)) {
        if (name === "large" || name === "small" || name === "original") {
          const type = (variant as { contentType?: string }).contentType ?? MEDIA_TYPES[row.kind]!;
          urls[name] = await this.media.signedUrl(variant.key, type);
        }
      }
    }
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      rejectReason: row.rejectReason,
      width: row.width,
      height: row.height,
      durationMs: row.durationMs,
      videoCodec: row.videoCodec,
      urls,
    };
  }

  private textsOf(ctx: Pick<GuideContext, "texts">, itemId: string): ItemView["texts"] {
    const texts: ItemView["texts"] = {};
    for (const text of ctx.texts.filter((candidate) => candidate.itemId === itemId)) {
      texts[text.language] = {
        doc: (text.doc as ItemText["doc"]) ?? null,
        origin: text.origin,
        state: text.state,
        pendingReason: text.pendingReason,
      };
    }
    return texts;
  }

  /** An item as the portal sees it; shared blocks pass their own texts and media. */
  async itemView(ctx: Pick<GuideContext, "texts" | "media">, item: ItemRow): Promise<ItemView> {
    const media = item.mediaId ? ctx.media.find((row) => row.id === item.mediaId) : undefined;
    return {
      id: item.id,
      kind: item.kind,
      position: item.position,
      source: item.source,
      sourceDetail: item.sourceDetail,
      reviewed: item.reviewedAt !== null,
      sourceLanguage: item.sourceLanguage,
      topics: item.topics,
      factKey: item.factKey,
      media: media ? await this.mediaView(media) : null,
      recommendation: (item.recommendation as Recommendation | null) ?? null,
      texts: this.textsOf(ctx, item.id),
      sharedBlockId: item.sharedBlockId,
    };
  }

  async sectionView(
    ctx: GuideContext,
    section: SectionRow,
    completeness: CompletenessResult,
  ): Promise<SectionView> {
    const own = await Promise.all(
      ctx.items
        .filter((item) => item.sectionId === section.id)
        .map((item) => this.itemView(ctx, item)),
    );
    const inherited: ItemView[] = inheritedBlocks(
      section.kind,
      ctx.sharedBlocks,
      ctx.links,
    ).flatMap((block) =>
      block.items.map((item, index) => ({
        id: item.id,
        kind: item.kind,
        position: own.length + index,
        source: "host" as const,
        sourceDetail: null,
        reviewed: true,
        sourceLanguage: item.sourceLanguage,
        topics: [],
        factKey: item.factKey ?? null,
        media: null,
        recommendation: (item.recommendation as Recommendation | undefined) ?? null,
        texts: Object.fromEntries(
          Object.entries(item.texts).map(([language, doc]) => [
            language,
            {
              doc: doc as ItemText["doc"],
              origin: "source" as const,
              state: "current" as const,
              pendingReason: null,
            },
          ]),
        ),
        sharedBlockId: block.blockId,
      })),
    );
    return {
      id: section.id,
      kind: section.kind,
      title: section.title ?? null,
      position: section.position,
      hidden: section.hidden,
      revision: section.revision,
      status: this.statusOf(ctx, section.id),
      completeness:
        section.kind === "custom" || section.hidden
          ? null
          : (completeness.sections[section.kind]?.score ?? null),
      items: [...own, ...inherited],
    };
  }

  private lockedFieldViews(ctx: GuideContext, caller: Caller): LockedFieldView[] {
    const manager = caller.role === "owner" || caller.role === "admin";
    return ctx.lockedFields.map((field) =>
      manager
        ? {
            id: field.id,
            kind: field.kind,
            label: field.label,
            sectionKind: field.sectionKind,
            isSet: field.isSet,
            isPublic: field.isPublic,
            source: field.source,
            valueSetAt: field.valueSetAt?.toISOString() ?? null,
            updatedBy: field.updatedBy,
          }
        : { id: field.id, kind: field.kind, label: field.label, locked: true as const },
    );
  }

  async view(ctx: GuideContext, caller: Caller): Promise<GuideView> {
    const completeness = this.completeness(ctx);
    const sections = await Promise.all(
      ctx.sections.map((section) => this.sectionView(ctx, section, completeness)),
    );
    return {
      id: ctx.guide.id,
      propertyId: ctx.property.id,
      propertyName: ctx.property.name,
      status: ctx.guide.status,
      hasUnpublishedChanges: ctx.guide.hasUnpublishedChanges,
      publishedVersion: ctx.publishedVersion,
      draftState: ctx.guide.draftState,
      completeness: completeness.guide,
      languages: ctx.property.guideLanguages,
      mainLanguage: mainLanguage(ctx.property.guideLanguages),
      setupReady: ctx.property.setupReady,
      facts: {
        checkInTime: ctx.property.checkInTime,
        checkoutTime: ctx.property.checkoutTime,
        maxGuests: ctx.property.maxGuests,
        address: ctx.property.address,
      },
      sections,
      lockedFields: this.lockedFieldViews(ctx, caller),
      missingTopics: completeness.missing,
      topicMarks: ctx.marks,
      sharedBlocks: ctx.sharedBlocks.map((block) => {
        const mode = ctx.links[block.blockId] ?? "inherit";
        const basedOn = ctx.linkRevisions[block.blockId] ?? null;
        return {
          id: block.blockId,
          name: ctx.blockNames[block.blockId] ?? "",
          sectionKind: block.sectionKind,
          mode,
          behind: mode === "override" && basedOn !== null && basedOn < block.revision,
        };
      }),
      canEdit: caller.role === "owner" || caller.role === "admin",
    };
  }
}
