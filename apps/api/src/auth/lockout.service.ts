import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { authLockout, type DbHandle } from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;
const WINDOW_SECONDS = LOCK_MINUTES * 60;
/** At most one lockout notice per key per hour, so locks can't be used to flood an inbox. */
const NOTICE_INTERVAL_SECONDS = 60 * 60;

export interface FailureResult {
  locked: boolean;
  /** True only on the failure that triggered the lock (send the notice once). */
  justLocked: boolean;
}

/** Keys never contain raw emails (SEC-20). */
export function emailKey(email: string): string {
  return `email:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
}

export function userKey(userId: string): string {
  return `user:${userId}`;
}

/**
 * 5 failures within 15 minutes lock the key for 15 minutes (AC-SEC-001, T059).
 *
 * Counting is one atomic statement (security review T103): parallel failures can't lose
 * increments, and an active lock is never shortened or cleared by a later failure.
 */
@Injectable()
export class LockoutService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async isLocked(key: string, now: Date = new Date()): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ lockedUntil: authLockout.lockedUntil })
      .from(authLockout)
      .where(eq(authLockout.key, key))
      .limit(1);
    return Boolean(row?.lockedUntil && row.lockedUntil > now);
  }

  async recordFailure(key: string, now: Date = new Date()): Promise<FailureResult> {
    const at = now.toISOString();
    const window = sql`make_interval(secs => ${WINDOW_SECONDS})`;
    const nowTs = sql`${at}::timestamptz`;
    const locked = sql`(auth_lockout.locked_until IS NOT NULL AND auth_lockout.locked_until > ${nowTs})`;
    const fresh = sql`(auth_lockout.window_started_at <= ${nowTs} - ${window} OR (auth_lockout.locked_until IS NOT NULL AND auth_lockout.locked_until <= ${nowTs}))`;
    const nextCount = sql`CASE WHEN ${locked} THEN auth_lockout.failure_count + 1 WHEN ${fresh} THEN 1 ELSE auth_lockout.failure_count + 1 END`;
    const result = await this.handle.db.execute<{
      failure_count: number;
      locked_until: string | Date | null;
    }>(sql`
      INSERT INTO auth_lockout AS auth_lockout (key, failure_count, window_started_at, locked_until)
      VALUES (
        ${key}, 1, ${nowTs},
        CASE WHEN 1 >= ${MAX_FAILURES} THEN ${nowTs} + ${window} ELSE NULL END
      )
      ON CONFLICT (key) DO UPDATE SET
        failure_count = ${nextCount},
        window_started_at = CASE
          WHEN ${locked} THEN auth_lockout.window_started_at
          WHEN ${fresh} THEN ${nowTs}
          ELSE auth_lockout.window_started_at
        END,
        locked_until = CASE
          WHEN ${locked} THEN auth_lockout.locked_until
          WHEN ${nextCount} >= ${MAX_FAILURES} THEN ${nowTs} + ${window}
          ELSE NULL
        END
      RETURNING failure_count, locked_until
    `);
    const row = result.rows[0];
    const lockedUntil = row?.locked_until ? new Date(row.locked_until) : null;
    const isLocked = Boolean(lockedUntil && lockedUntil > now);
    // The count restarts at 1 after a lock expires, so it equals the limit exactly once per lock.
    return {
      locked: isLocked,
      justLocked: isLocked && Number(row?.failure_count) === MAX_FAILURES,
    };
  }

  /** True when a lockout notice may be sent now (at most one per key per hour). */
  async claimNotice(key: string, now: Date = new Date()): Promise<boolean> {
    const at = now.toISOString();
    const result = await this.handle.db.execute(sql`
      UPDATE auth_lockout SET notified_at = ${at}::timestamptz
      WHERE key = ${key}
        AND (notified_at IS NULL OR notified_at <= ${at}::timestamptz - make_interval(secs => ${NOTICE_INTERVAL_SECONDS}))
      RETURNING key
    `);
    return result.rows.length > 0;
  }

  async reset(key: string): Promise<void> {
    await this.handle.db.delete(authLockout).where(eq(authLockout.key, key));
  }
}
