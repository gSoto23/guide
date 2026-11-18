import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { LocalMediaStorage, S3MediaStorage, type MediaStoragePort } from "@guidesk/integrations";
import type { ApiConfig } from "../config/config.js";

export const MEDIA_STORAGE = Symbol("MEDIA_STORAGE");

/** The development-only route that stands in for signed S3 GET URLs (STORAGE_MODE=local). */
export const LOCAL_MEDIA_PATH = "/api/v1/local-media";

/**
 * The secret that signs local media URLs, derived from FEED_URL_PEPPER so the API and the worker
 * sign alike without another setting. Development and test only.
 */
export function localMediaSecret(pepper: string): Buffer {
  return createHmac("sha256", pepper).update("guidesk-local-media").digest();
}

/**
 * The media bucket in AWS; a folder next to the local uploads in development and test (feature
 * 003 research R9). Signed URLs point to the portal's origin, which forwards /api/* to the API.
 */
export function createMediaStorage(config: ApiConfig): MediaStoragePort {
  const storage = config.integrations.storage;
  return storage.mode === "s3"
    ? new S3MediaStorage({ bucket: storage.mediaBucket })
    : new LocalMediaStorage({
        dir: storage.dir,
        mediaUrl: new URL(LOCAL_MEDIA_PATH, config.PORTAL_URL).toString(),
        secret: localMediaSecret(config.integrations.feedUrlPepper),
      });
}

/**
 * Serves a locally stored media object behind a signed, expiring URL, as S3 does (local mode
 * only). The stored type and `inline` are sent, with `nosniff` and a sandboxing CSP, so the file
 * is never run as a page.
 */
export function registerLocalMediaRoute(fastify: FastifyInstance, media: MediaStoragePort): void {
  if (!(media instanceof LocalMediaStorage)) return;
  fastify.get(LOCAL_MEDIA_PATH, async (request, reply) => {
    const verified = media.verify(request.query as Record<string, string | undefined>);
    if (!verified) return reply.status(403).send({ code: "invalid_signature" });
    const bytes = await media.get(verified.key).catch(() => null);
    if (!bytes) return reply.status(404).send({ code: "not_found" });
    return reply
      .header("content-type", verified.contentType)
      .header("content-disposition", "inline")
      .header("x-content-type-options", "nosniff")
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("cache-control", "private, max-age=900")
      .send(bytes);
  });
}
