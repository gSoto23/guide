import { and, eq } from "drizzle-orm";
import { mediaObject, type Database } from "@guidesk/db";
import { JOB_QUEUES, type MediaCopyJob } from "@guidesk/domain";
import type { MediaStoragePort } from "@guidesk/integrations";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Media for a duplicated property (feature 003 FR-067, research R16): each variant of the source
 * media object is copied to the new object's own prefix, so either property can be deleted
 * without taking the other's images. The new object is `ready` once every variant is copied.
 */
export interface MediaCopyDeps {
  db: Database;
  media: MediaStoragePort;
  span?: JobSpanDeps;
}

export type MediaCopyOutcome = "copied" | "source_missing" | "skipped";

export async function runMediaCopy(
  deps: MediaCopyDeps,
  job: MediaCopyJob,
): Promise<MediaCopyOutcome> {
  const { db } = deps;
  const [target] = await db
    .select()
    .from(mediaObject)
    .where(and(eq(mediaObject.id, job.mediaId), eq(mediaObject.workspaceId, job.workspaceId)))
    .limit(1);
  if (!target || target.status !== "processing") return "skipped";
  const [source] = await db
    .select()
    .from(mediaObject)
    .where(and(eq(mediaObject.id, job.sourceMediaId), eq(mediaObject.workspaceId, job.workspaceId)))
    .limit(1);
  if (!source || source.status !== "ready") {
    await db
      .update(mediaObject)
      .set({ status: "rejected", rejectReason: "unreadable" })
      .where(eq(mediaObject.id, target.id));
    return "source_missing";
  }
  const variants: typeof source.variants = {};
  for (const [name, variant] of Object.entries(source.variants)) {
    const key = target.objectPrefix + variant.key.slice(source.objectPrefix.length);
    await deps.media.copy(variant.key, key);
    variants[name] = { ...variant, key };
  }
  await db
    .update(mediaObject)
    .set({
      status: "ready",
      variants,
      bytes: source.bytes,
      width: source.width,
      height: source.height,
      durationMs: source.durationMs,
      videoCodec: source.videoCodec,
    })
    .where(eq(mediaObject.id, target.id));
  return "copied";
}

/** The pg-boss handler: one span per job (constitution VIII). */
export function createMediaCopyHandler(deps: MediaCopyDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<MediaCopyJob>;
      if (
        typeof data.workspaceId !== "string" ||
        typeof data.mediaId !== "string" ||
        typeof data.sourceMediaId !== "string"
      ) {
        continue;
      }
      const payload: MediaCopyJob = {
        workspaceId: data.workspaceId,
        mediaId: data.mediaId,
        sourceMediaId: data.sourceMediaId,
      };
      await runInJobSpan(
        { queue: JOB_QUEUES.mediaCopy, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await runMediaCopy(deps, payload);
          span.set({ "job.outcome": outcome });
        },
        deps.span,
      );
    }
  };
}
