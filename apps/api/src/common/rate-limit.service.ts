import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { DbHandle } from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limiter in PostgreSQL (research R8, T024). Keys look like
 * `otp-send:email:<hash>` or `invite:workspace:<id>`. No Redis (performance doc §4).
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const result = await this.handle.db.execute<{ count: number; retry_after: number }>(sql`
      INSERT INTO rate_limit_bucket (key, window_start, count)
      VALUES (${key}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}) * ${windowSeconds}), 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_bucket.count + 1
      RETURNING count,
        ceil(extract(epoch FROM (window_start + make_interval(secs => ${windowSeconds}) - now())))::int AS retry_after
    `);
    const row = result.rows[0];
    const count = Number(row?.count ?? 0);
    return {
      allowed: count <= limit,
      count,
      retryAfterSeconds: Math.max(1, Number(row?.retry_after ?? windowSeconds)),
    };
  }
}
