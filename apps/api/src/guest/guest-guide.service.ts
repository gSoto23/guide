import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import type {
  GuestGuide,
  GuestItem,
  GuestLockedField,
  GuestMedia,
  GuidePreview,
  PreviewItem,
} from "@guidesk/contracts";
import { extra, guide, guideVersion, mediaObject, property, restrictedValue } from "@guidesk/db";
import { emergencyNumberFor, mainLanguage, type GuideLanguage } from "@guidesk/domain";
import type { MediaStoragePort } from "@guidesk/integrations";
import { PublishService } from "../guides/publish.service.js";
import { MEDIA_STORAGE } from "../uploads/media.provider.js";
import { ExploreSelection } from "../explore/explore-selection.js";
import { GuestExtrasService } from "./extras.service.js";
import { GuestContext, unavailable, type GuestTarget } from "./guest-context.js";

/** Image and video variants a guest page may request (research R11). */
export const GUEST_MEDIA_VARIANTS = ["large", "small", "original"] as const;
export type GuestMediaVariant = (typeof GUEST_MEDIA_VARIANTS)[number];

const MEDIA_TYPES: Record<string, string> = { image: "image/webp", video: "video/mp4" };

function hhmm(time: string | null): string | null {
  return time ? time.slice(0, 5) : null;
}

/**
 * The public guide (feature 004 FR-003 to FR-018, research R11): feature 003's published preview
 * for one language, read in the guest context, plus what the guest pages need. It never carries a
 * locked value; a Wi-Fi password appears only when the host made it public (FR-018).
 */
@Injectable()
export class GuestGuideService {
  constructor(
    private readonly context: GuestContext,
    private readonly publish: PublishService,
    @Inject(MEDIA_STORAGE) private readonly media: MediaStoragePort,
    private readonly explore: ExploreSelection,
    private readonly extras: GuestExtrasService,
  ) {}

  async guide(publicId: string, lang: GuideLanguage | undefined): Promise<GuestGuide> {
    const target = await this.context.byPublicId(publicId);
    return this.context.run(async () => {
      const preview = await this.publish.preview(target.workspaceId, target.propertyId, {
        source: "published",
        ...(lang ? { lang } : {}),
      });
      return this.toGuest(target, preview);
    });
  }

  /** A signed URL for one media variant of the published guide, or `unavailable` (research R11). */
  async mediaUrl(publicId: string, mediaId: string, variant: GuestMediaVariant): Promise<string> {
    const target = await this.context.byPublicId(publicId);
    // Only media the published version references, the property's cover, or a visible extra's
    // photo (feature 016 FR-005): never draft or removed media.
    if (!(await this.isPhotoOf(target, mediaId))) await this.assertPublished(target, mediaId);
    const [row] = await this.context.db
      .select({
        kind: mediaObject.kind,
        status: mediaObject.status,
        variants: mediaObject.variants,
      })
      .from(mediaObject)
      .where(and(eq(mediaObject.id, mediaId), eq(mediaObject.workspaceId, target.workspaceId)))
      .limit(1);
    const stored = row?.status === "ready" ? row.variants[variant] : undefined;
    if (!row || !stored) throw unavailable();
    const type = (stored as { contentType?: string }).contentType ?? MEDIA_TYPES[row.kind]!;
    return this.media.signedUrl(stored.key, type);
  }

  /** The property's current cover or the photo of one of its visible extras (feature 016). */
  private async isPhotoOf(target: GuestTarget, mediaId: string): Promise<boolean> {
    if (target.coverMediaId === mediaId) return true;
    const [row] = await this.context.db
      .select({ id: extra.id })
      .from(extra)
      .where(
        and(
          eq(extra.propertyId, target.propertyId),
          eq(extra.workspaceId, target.workspaceId),
          eq(extra.visible, true),
          eq(extra.mediaId, mediaId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  private async assertPublished(target: GuestTarget, mediaId: string): Promise<void> {
    const [published] = await this.context.db
      .select({ id: guideVersion.id })
      .from(guide)
      .innerJoin(guideVersion, eq(guideVersion.id, guide.publishedVersionId))
      .where(
        and(
          eq(guide.id, target.guideId),
          sql`jsonb_path_exists(${guideVersion.snapshot}, '$.sections[*].items[*] ? (@.mediaId == $id)', jsonb_build_object('id', ${mediaId}::text))`,
        ),
      )
      .limit(1);
    if (!published) throw unavailable();
  }

  /** Feature 016: the cover for guests, on the gated guest media path. */
  private async coverOf(target: GuestTarget): Promise<GuestGuide["cover"]> {
    if (!target.coverMediaId) return null;
    const [row] = await this.context.db
      .select({
        width: mediaObject.width,
        height: mediaObject.height,
        variants: mediaObject.variants,
      })
      .from(mediaObject)
      .where(
        and(
          eq(mediaObject.id, target.coverMediaId),
          eq(mediaObject.workspaceId, target.workspaceId),
          eq(mediaObject.kind, "image"),
          eq(mediaObject.status, "ready"),
        ),
      )
      .limit(1);
    if (!row) return null;
    const path = (variant: string) =>
      `/api/v1/guest/media/${target.publicId}/${target.coverMediaId}/${variant}`;
    return {
      url: path("large"),
      smallUrl: row.variants.small ? path("small") : null,
      width: row.width,
      height: row.height,
      alt: target.coverAlt ?? target.propertyName,
    };
  }

  private async toGuest(target: GuestTarget, preview: GuidePreview): Promise<GuestGuide> {
    const db = this.context.db;
    const [facts] = await db
      .select({
        maxGuests: property.maxGuests,
        addressLine1: property.addressLine1,
        addressUnit: property.addressUnit,
        city: property.city,
      })
      .from(property)
      .where(and(eq(property.id, target.propertyId), eq(property.workspaceId, target.workspaceId)))
      .limit(1);
    const [published] = await db
      .select({ publishedAt: guide.publishedAt })
      .from(guide)
      .where(eq(guide.id, target.guideId))
      .limit(1);
    // restricted_value_public filters by the member's workspace, which guests don't have; read
    // the safe columns directly, scoped by the resolved workspace and property (research R12).
    const fields = await db
      .select({
        id: restrictedValue.id,
        kind: restrictedValue.kind,
        label: restrictedValue.label,
        publicValue: restrictedValue.publicValue,
        isSet: sql<boolean>`(${restrictedValue.valueCiphertext} IS NOT NULL)`,
      })
      .from(restrictedValue)
      .where(
        and(
          eq(restrictedValue.workspaceId, target.workspaceId),
          eq(restrictedValue.propertyId, target.propertyId),
        ),
      )
      .orderBy(asc(restrictedValue.createdAt));
    const lockedFields: GuestLockedField[] = fields
      .filter((field) => field.publicValue === null)
      .map((field) => ({
        id: field.id,
        kind: field.kind as GuestLockedField["kind"],
        label: field.label,
        set: Boolean(field.isSet),
      }));
    const publicWifi = fields.find(
      (field) => field.kind === "wifi_password" && field.publicValue !== null,
    );
    const address = [facts?.addressLine1, facts?.addressUnit, facts?.city]
      .filter(Boolean)
      .join(", ");
    const languages = preview.languages as GuideLanguage[];
    const sections = preview.sections
      .map((section) => ({
        id: section.id,
        kind: section.kind,
        title: section.title,
        items: section.items
          .map((item) => this.item(target, preview.language as GuideLanguage, item))
          .filter((item): item is GuestItem => item !== null),
      }))
      .filter((section) => section.items.length > 0);
    // Feature 009: the Explore tab shows with host tips or selected experiences (FR-001).
    const tips = sections.some((section) => section.items.some((item) => item.recommendation));
    const explore = tips
      ? { visible: true }
      : {
          visible:
            (
              await this.explore.forProperty(
                db,
                target.workspaceId,
                target.propertyId,
                preview.language as GuideLanguage,
              )
            ).selected.length > 0,
        };
    return {
      publicId: target.publicId,
      language: preview.language as GuideLanguage,
      languages,
      primaryLanguage: mainLanguage(languages) as GuideLanguage,
      propertyName: preview.propertyName,
      timeZone: target.timeZone,
      country: target.country,
      emergencyNumber: emergencyNumberFor(target.country),
      facts: {
        checkInTime: hhmm(target.checkInTime),
        checkoutTime: hhmm(target.checkoutTime),
        maxGuests: facts?.maxGuests ?? null,
        address: address || null,
      },
      publishedAt: published?.publishedAt?.toISOString() ?? null,
      sections,
      lockedFields,
      wifi: {
        fieldId: publicWifi?.id ?? null,
        password: publicWifi?.publicValue ?? null,
      },
      explore,
      // Feature 008: the Extras entry shows when the property has visible extras (FR-007).
      extras: { visible: (await this.extras.visible(db, target)).length > 0 },
      // Feature 015 FR-022: only Free-plan guides carry the Guidesk credit.
      credit: target.plan === "free",
      cover: await this.coverOf(target),
    };
  }

  private item(target: GuestTarget, language: GuideLanguage, item: PreviewItem): GuestItem | null {
    const base = {
      id: item.id,
      kind: item.kind,
      language: item.docLanguage as GuideLanguage,
      translated: item.docLanguage === language,
      doc: item.doc,
    };
    if (item.kind === "image" || item.kind === "video") {
      const media = item.media ? this.guestMedia(target.publicId, item.media) : null;
      if (!media) return null;
      return { ...base, translated: true, media };
    }
    if (item.kind === "fact") {
      if (!item.fact) return null;
      return { ...base, translated: true, fact: item.fact };
    }
    if (item.kind === "recommendation") {
      const rec = item.recommendation;
      if (!rec) return null;
      const benefit = rec.benefit !== undefined && rec.benefit !== "none";
      return {
        ...base,
        recommendation: {
          name: rec.name,
          category: rec.category,
          url: rec.url ?? null,
          address: rec.address ?? null,
          benefit,
          benefitKind: rec.benefit ?? null,
          personalTip: rec.personalTip ?? false,
        },
      };
    }
    return item.doc ? base : null;
  }

  private guestMedia(
    publicId: string,
    media: NonNullable<PreviewItem["media"]>,
  ): GuestMedia | null {
    if (media.status !== "ready") return null;
    const path = (variant: GuestMediaVariant) =>
      `/api/v1/guest/media/${publicId}/${media.id}/${variant}`;
    if (media.kind === "video") {
      return media.urls.original
        ? {
            kind: "video",
            url: path("original"),
            smallUrl: null,
            width: media.width,
            height: media.height,
          }
        : null;
    }
    const main = media.urls.large ? "large" : media.urls.original ? "original" : null;
    if (!main) return null;
    return {
      kind: "image",
      url: path(main),
      smallUrl: media.urls.small ? path("small") : null,
      width: media.width,
      height: media.height,
    };
  }
}
