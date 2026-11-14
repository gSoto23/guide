/**
 * Typed access to the append-only security log. The table itself (monthly partitions, trigger,
 * RLS) is created by the custom migration 0002_security_event.sql, not by drizzle-kit.
 */
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const securityEvent = pgTable("security_event", {
  id: uuid("id").notNull().defaultRandom(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  type: text("type").notNull(),
  outcome: text("outcome", { enum: ["success", "failure", "denied"] }).notNull(),
  actorUserId: text("actor_user_id"),
  workspaceId: uuid("workspace_id"),
  targetType: text("target_type"),
  targetId: text("target_id"),
  ipHash: text("ip_hash"),
  approxLocation: text("approx_location"),
  userAgentFamily: text("user_agent_family"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
});
