/**
 * Idempotency keys for retried POSTs (contracts/http-api.md, cross-cutting guarantees). System
 * context only: guidesk_app has no access. Rows older than a day are ignored and pruned.
 */
import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth.js";

export const idempotencyKey = pgTable(
  "idempotency_key",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** Method and route pattern, so one key can't replay another endpoint's response. */
    route: text("route").notNull(),
    /** Null while the first request is still running. */
    status: integer("status"),
    body: jsonb("body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);
