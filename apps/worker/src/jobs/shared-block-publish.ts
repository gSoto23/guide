import { and, eq, isNotNull, sql } from "drizzle-orm";
import { guide, guideSharedLink, guideVersion, sharedBlock, type Database } from "@guidesk/db";
import {
  applySharedBlock,
  JOB_QUEUES,
  snapshotsDiffer,
  SNAPSHOT_SCHEMA,
  type GuideSnapshot,
  type SharedBlockPublishJob,
  type SharedBlockSnapshot,
} from "@guidesk/domain";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Shared-block fan-out (feature 003 US7, research R14, FR-060): after a block is published or
 * deleted, every published guide of the workspace gets a new version made from its **previous
 * published snapshot** with that block's items replaced, added, or removed. Guides that override
 * or exclude the block are left as they are, and no draft edit ever goes live this way.
 */
export interface SharedBlockPublishDeps {
  db: Database;
  span?: JobSpanDeps;
}

export interface SharedBlockPublishResult {
  guidesUpdated: number;
}

export async function runSharedBlockPublish(
  deps: SharedBlockPublishDeps,
  job: SharedBlockPublishJob,
): Promise<SharedBlockPublishResult> {
  const { db } = deps;
  let block: SharedBlockSnapshot | null = null;
  if (job.change === "published") {
    const [row] = await db
      .select({
        id: sharedBlock.id,
        sectionKind: sharedBlock.sectionKind,
        position: sharedBlock.position,
        revision: sharedBlock.publishedRevision,
        snapshot: sharedBlock.publishedSnapshot,
      })
      .from(sharedBlock)
      .where(
        and(eq(sharedBlock.id, job.sharedBlockId), eq(sharedBlock.workspaceId, job.workspaceId)),
      )
      .limit(1);
    // A block deleted after its publish was queued is handled by the delete's own job.
    if (!row || row.snapshot === null) return { guidesUpdated: 0 };
    block = {
      blockId: row.id,
      sectionKind: row.sectionKind,
      position: row.position,
      revision: row.revision ?? 0,
      items: (row.snapshot as { items?: SharedBlockSnapshot["items"] }).items ?? [],
    };
  }

  const guides = await db
    .select({ id: guide.id, versionId: guide.publishedVersionId })
    .from(guide)
    .where(
      and(
        eq(guide.workspaceId, job.workspaceId),
        eq(guide.status, "published"),
        isNotNull(guide.publishedVersionId),
      ),
    );
  let guidesUpdated = 0;
  for (const target of guides) {
    const updated = await db.transaction(async (tx) => {
      // One writer per guide: a publish by the host and the fan-out never collide on numbers.
      await tx.execute(sql`SELECT id FROM guide WHERE id = ${target.id} FOR UPDATE`);
      const [current] = await tx
        .select({
          versionId: guide.publishedVersionId,
          status: guide.status,
        })
        .from(guide)
        .where(eq(guide.id, target.id))
        .limit(1);
      if (!current?.versionId || current.status !== "published") return false;
      const [version] = await tx
        .select({ snapshot: guideVersion.snapshot, languages: guideVersion.languages })
        .from(guideVersion)
        .where(eq(guideVersion.id, current.versionId))
        .limit(1);
      if (!version) return false;
      const [link] = await tx
        .select({ mode: guideSharedLink.mode })
        .from(guideSharedLink)
        .where(
          and(
            eq(guideSharedLink.guideId, target.id),
            eq(guideSharedLink.sharedBlockId, job.sharedBlockId),
          ),
        )
        .limit(1);
      const previous = version.snapshot as GuideSnapshot;
      const next = applySharedBlock(previous, job.sharedBlockId, block, link?.mode);
      if (!snapshotsDiffer(previous, next)) return false;
      const [last] = await tx
        .select({ number: sql<number>`coalesce(max(${guideVersion.number}), 0)::int` })
        .from(guideVersion)
        .where(eq(guideVersion.guideId, target.id));
      const [created] = await tx
        .insert(guideVersion)
        .values({
          workspaceId: job.workspaceId,
          guideId: target.id,
          number: (last?.number ?? 0) + 1,
          cause: job.change === "published" ? "shared_block" : "shared_block_removed",
          snapshot: next,
          snapshotSchema: SNAPSHOT_SCHEMA,
          languages: version.languages,
          publishedBy: null,
          sharedBlockId: job.sharedBlockId,
        })
        .returning({ id: guideVersion.id });
      // Unpublished draft changes stay as they were (data model §7).
      await tx
        .update(guide)
        .set({ publishedVersionId: created!.id, publishedAt: new Date() })
        .where(eq(guide.id, target.id));
      return true;
    });
    if (updated) guidesUpdated += 1;
  }
  return { guidesUpdated };
}

/** The pg-boss handler: one span per job (constitution VIII), counts only. */
export function createSharedBlockPublishHandler(deps: SharedBlockPublishDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<SharedBlockPublishJob>;
      if (
        typeof data.workspaceId !== "string" ||
        typeof data.sharedBlockId !== "string" ||
        (data.change !== "published" && data.change !== "deleted")
      ) {
        continue;
      }
      const payload: SharedBlockPublishJob = {
        workspaceId: data.workspaceId,
        sharedBlockId: data.sharedBlockId,
        change: data.change,
      };
      await runInJobSpan(
        { queue: JOB_QUEUES.sharedBlockPublish, workspaceId: payload.workspaceId },
        async (span) => {
          const result = await runSharedBlockPublish(deps, payload);
          span.set({ "job.guides_updated": result.guidesUpdated });
        },
        deps.span,
      );
    }
  };
}
