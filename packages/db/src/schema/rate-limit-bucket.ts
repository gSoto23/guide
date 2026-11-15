/**
 * Guidesk fixed-window rate limiter storage (research R8, T024): one-time code sends,
 * verification failures, and invitation sends. No Redis (performance doc §4).
 */
import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const rateLimitBucket = pgTable(
  "rate_limit_bucket",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
