import { and, eq, lte } from "drizzle-orm";
import { property, type Database } from "@guidesk/db";
import { JOB_QUEUES } from "@guidesk/domain";
import { recordEvent } from "./pms-common.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Daily permanent deletion of properties removed more than 30 days ago (FR-045, data model §6,
 * T118). Deleting the property deletes its stays, listing content, feeds, and restricted values
 * with it (`ON DELETE CASCADE`); import items and extractions only lose the link. Each deletion
 * is logged as `property.purged`.
 */
export const PURGE_PROPERTIES_CRON = "45 3 * * *";

/** Properties purged per run; the rest wait for the next day. */
const BATCH = 500;

export interface PropertiesPurgeDeps {
  db: Database;
  now?: () => Date;
  span?: JobSpanDeps;
}

/** Purges every property due; returns how many were deleted. */
export async function runPropertiesPurge(deps: PropertiesPurgeDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const due = (id?: string) =>
    and(
      ...(id ? [eq(property.id, id)] : []),
      eq(property.status, "removed"),
      lte(property.purgeAfter, now),
    );
  const rows = await deps.db
    .select({ id: property.id, workspaceId: property.workspaceId })
    .from(property)
    .where(due())
    .limit(BATCH);
  let purged = 0;
  for (const row of rows) {
    await deps.db.transaction(async (tx) => {
      // Checked again, so a property restored meanwhile is kept.
      const deleted = await tx.delete(property).where(due(row.id)).returning({ id: property.id });
      if (deleted.length === 0) return;
      await recordEvent(tx as unknown as Database, {
        type: "property.purged",
        workspaceId: row.workspaceId,
        actorUserId: null,
        targetType: "property",
        targetId: row.id,
        metadata: {},
      });
      purged += 1;
    });
  }
  return purged;
}

/** The pg-boss handler for the daily schedule: one span per run (constitution VIII). */
export function createPropertiesPurgeHandler(deps: PropertiesPurgeDeps) {
  return async (): Promise<void> => {
    await runInJobSpan(
      { queue: JOB_QUEUES.propertiesPurge },
      async (span) => {
        const purged = await runPropertiesPurge(deps);
        span.set({ "job.outcome": "completed", "properties.purged": purged });
      },
      deps.span,
    );
  };
}
