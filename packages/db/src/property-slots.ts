import { sql } from "drizzle-orm";
import { effectivePropertyLimit, isPlan } from "@guidesk/domain";
import type { Database } from "./client.js";
import type { Transaction } from "./rls.js";

export interface PropertySlots {
  workspaceStatus: "active" | "pending_deletion";
  /** The effective property limit (feature 011: custom limit ?? plan); null is unlimited. */
  limit: number | null;
  /** Active properties; removed ones do not count (FR-047). */
  used: number;
}

/**
 * Locks the workspace row until the transaction ends, then counts its active properties
 * (FR-047, research R12). Every creation path calls this before inserting, so parallel creations
 * and imports cannot exceed the limit. Works in the request context (owners and admins, who may
 * lock the row) and in the system context. Returns null when the row is not visible.
 */
export async function lockPropertySlots(
  tx: Database | Transaction,
  workspaceId: string,
): Promise<PropertySlots | null> {
  const locked = await tx.execute<{ status: string; plan: string; property_limit: number | null }>(
    sql`SELECT status, plan, property_limit FROM workspace WHERE id = ${workspaceId} FOR UPDATE`,
  );
  const row = locked.rows[0];
  if (!row) return null;
  const counted = await tx.execute<{ used: number }>(
    sql`SELECT count(*)::int AS used FROM property WHERE workspace_id = ${workspaceId} AND status = 'active'`,
  );
  return {
    workspaceStatus: row.status === "pending_deletion" ? "pending_deletion" : "active",
    limit: effectivePropertyLimit({
      plan: isPlan(row.plan) ? row.plan : "free",
      propertyLimit: row.property_limit === null ? null : Number(row.property_limit),
    }),
    used: Number(counted.rows[0]?.used ?? 0),
  };
}

/** Active properties of a workspace, for the MFA threshold (FR-048). */
export async function countActiveProperties(
  db: Database | Transaction,
  workspaceId: string,
): Promise<number> {
  const result = await db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM property WHERE workspace_id = ${workspaceId} AND status = 'active'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
