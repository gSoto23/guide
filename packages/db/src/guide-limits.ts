import { and, eq, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import type { Transaction } from "./rls.js";
import { mediaObject } from "./schema/guides.js";

/**
 * Counters behind the guide builder's limits (feature 003 FR-064, FR-065). The AI count lives in
 * `rate_limit_bucket` (system context only, feature 001 migration 0008), one key per workspace and
 * UTC day; media usage is the sum of ready media objects.
 */
export async function consumeDailyCount(
  db: Database,
  key: string,
  limit: number,
): Promise<{ allowed: boolean; count: number }> {
  const result = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limit_bucket (key, window_start, count)
    VALUES (${key}, date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_bucket.count + 1
    RETURNING count
  `);
  const count = Number(result.rows[0]?.count ?? 0);
  return { allowed: count <= limit, count };
}

/** Today's count for a daily key, without taking one. */
export async function dailyCount(db: Database, key: string): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`SELECT coalesce(sum(count), 0)::int AS count FROM rate_limit_bucket WHERE key = ${key}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Bytes of ready media a workspace stores (FR-065). */
export async function mediaBytesUsed(
  db: Database | Transaction,
  workspaceId: string,
): Promise<number> {
  const [row] = await db
    .select({ bytes: sql<number>`coalesce(sum(${mediaObject.bytes}), 0)::bigint` })
    .from(mediaObject)
    .where(and(eq(mediaObject.workspaceId, workspaceId), eq(mediaObject.status, "ready")));
  return Number(row?.bytes ?? 0);
}
