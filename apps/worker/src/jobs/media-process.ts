import { and, eq, sql } from "drizzle-orm";
import {
  derivedBasis,
  mediaBytesUsed,
  mediaObject,
  upload,
  workspaceLimitInputs,
  type Database,
} from "@guidesk/db";
import { JOB_QUEUES, mediaStorageLimitBytes, type MediaProcessJob } from "@guidesk/domain";
import type { MediaStoragePort, ObjectStoragePort, SandboxPort } from "@guidesk/integrations";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Guide media processing (feature 003 research R9, SEC-10): waits for the malware scan, has the
 * file processor clean the file into the media bucket, checks the storage limit with the real
 * size (FR-065), and marks the media ready or rejected with a reason. The upload is deleted by the
 * file processor in every case.
 */
export interface MediaProcessDeps {
  db: Database;
  sandbox: SandboxPort;
  storage: ObjectStoragePort;
  media: MediaStoragePort;
  /** True in AWS: GuardDuty's scan result must be in before the file is read. */
  requireScan: boolean;
  span?: JobSpanDeps;
}

export type MediaProcessOutcome = "ready" | "rejected" | "skipped";

/** Thrown while the scan result is not in yet, so pg-boss retries the job. */
export class ScanPendingError extends Error {
  constructor() {
    super("malware scan pending");
  }
}

const REASONS = new Set([
  "unsupported_type",
  "too_large",
  "too_long",
  "unsupported_codec",
  "unreadable",
]);

export async function runMediaProcess(
  deps: MediaProcessDeps,
  job: MediaProcessJob,
): Promise<MediaProcessOutcome> {
  const { db } = deps;
  const [row] = await db
    .select({
      id: mediaObject.id,
      kind: mediaObject.kind,
      status: mediaObject.status,
      prefix: mediaObject.objectPrefix,
      uploadId: mediaObject.uploadId,
      objectKey: upload.objectKey,
    })
    .from(mediaObject)
    .leftJoin(upload, eq(upload.id, mediaObject.uploadId))
    .where(and(eq(mediaObject.id, job.mediaId), eq(mediaObject.workspaceId, job.workspaceId)))
    .limit(1);
  if (!row || row.status !== "processing" || !row.objectKey) return "skipped";

  const reject = async (reason: string): Promise<MediaProcessOutcome> => {
    await db
      .update(mediaObject)
      .set({ status: "rejected", rejectReason: reason })
      .where(eq(mediaObject.id, row.id));
    if (row.uploadId) {
      await db
        .update(upload)
        .set({ status: "rejected", rejectReason: reason })
        .where(eq(upload.id, row.uploadId));
    }
    return "rejected";
  };

  if (deps.requireScan) {
    const scan = await deps.storage.scanStatus(row.objectKey);
    if (scan === "pending") throw new ScanPendingError();
    if (scan === "threats") {
      await deps.storage.delete(row.objectKey);
      return reject("malware");
    }
    if (scan === "failed") {
      await deps.storage.delete(row.objectKey);
      return reject("unreadable");
    }
  }

  const response = await deps.sandbox.processFile({
    objectKey: row.objectKey,
    purpose: row.kind === "image" ? "media_image" : "media_video",
    mediaPrefix: row.prefix,
  });
  if ("error" in response)
    return reject(REASONS.has(response.error) ? response.error : "unreadable");
  if (!("media" in response)) return reject("unreadable");

  const inputs = await workspaceLimitInputs(db, job.workspaceId);
  const limit = mediaStorageLimitBytes(
    inputs ? derivedBasis(inputs) : 2,
    inputs?.mediaStorageLimitMb,
  );
  if ((await mediaBytesUsed(db, job.workspaceId)) + response.media.bytes > limit) {
    await deps.media.deletePrefix(row.prefix);
    return reject("storage_limit");
  }
  await db
    .update(mediaObject)
    .set({
      status: "ready",
      variants: response.media.variants,
      bytes: response.media.bytes,
      width: response.media.width ?? null,
      height: response.media.height ?? null,
      durationMs: response.media.durationMs ?? null,
      videoCodec: response.media.codec ?? null,
      rejectReason: null,
    })
    .where(eq(mediaObject.id, row.id));
  if (row.uploadId) {
    await db
      .update(upload)
      .set({ status: "deleted", deletedAt: sql`now()` })
      .where(eq(upload.id, row.uploadId));
  }
  return "ready";
}

/** The pg-boss handler: one span per job (constitution VIII), outcome only. */
export function createMediaProcessHandler(deps: MediaProcessDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<MediaProcessJob>;
      if (typeof data.mediaId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload = { mediaId: data.mediaId, workspaceId: data.workspaceId };
      await runInJobSpan(
        { queue: JOB_QUEUES.mediaProcess, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await runMediaProcess(deps, payload);
          span.set({ "job.outcome": outcome });
        },
        deps.span,
      );
    }
  };
}
