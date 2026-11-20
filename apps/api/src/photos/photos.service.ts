import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { mediaObject } from "@guidesk/db";
import type { MediaStoragePort } from "@guidesk/integrations";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { MEDIA_STORAGE } from "../uploads/media.provider.js";

/** Signed member URLs of a ready image (valid for 15 minutes). */
export interface MemberImage {
  url: string;
  smallUrl: string | null;
}

type Variants = Record<string, { key: string; contentType?: string }>;

/**
 * Property covers and extras photos (feature 016): they reuse the guide media pipeline (spec 003),
 * so this only checks a reference and signs URLs for members.
 */
@Injectable()
export class PhotosService {
  constructor(
    private readonly requestDb: RequestDb,
    @Inject(MEDIA_STORAGE) private readonly media: MediaStoragePort,
  ) {}

  /** A cover or extra photo must be a ready image of the same workspace (FR-003, FR-008). */
  async assertImage(workspaceId: string, mediaId: string): Promise<void> {
    const [row] = await this.requestDb
      .current()
      .select({ kind: mediaObject.kind, status: mediaObject.status })
      .from(mediaObject)
      .where(and(eq(mediaObject.id, mediaId), eq(mediaObject.workspaceId, workspaceId)))
      .limit(1);
    if (!row || row.kind !== "image" || row.status === "rejected") {
      throw new ApiProblem(422, "invalid_media", "Choose a photo uploaded to this workspace.");
    }
    if (row.status !== "ready") {
      throw new ApiProblem(422, "media_not_ready", "The photo is still being processed.");
    }
  }

  /** Signed URLs for the ready images among `ids`, by media ID. */
  async memberImages(
    ids: readonly (string | null | undefined)[],
  ): Promise<Map<string, MemberImage>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const images = new Map<string, MemberImage>();
    if (wanted.length === 0) return images;
    const rows = await this.requestDb
      .current()
      .select({ id: mediaObject.id, variants: mediaObject.variants })
      .from(mediaObject)
      .where(
        and(
          inArray(mediaObject.id, wanted),
          eq(mediaObject.kind, "image"),
          eq(mediaObject.status, "ready"),
        ),
      );
    for (const row of rows) {
      const variants = row.variants as Variants;
      const sign = (variant: { key: string; contentType?: string } | undefined) =>
        variant ? this.media.signedUrl(variant.key, variant.contentType ?? "image/webp") : null;
      const large = await sign(variants.large ?? variants.original);
      if (!large) continue;
      images.set(row.id, { url: large, smallUrl: await sign(variants.small) });
    }
    return images;
  }
}
