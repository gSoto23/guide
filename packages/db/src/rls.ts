import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

/** The role every request transaction runs as (migration 0000_roles.sql). */
export const APP_ROLE = "guidesk_app";

export interface RlsContext {
  /** The signed-in user (Better Auth user ID). */
  userId: string;
  /** Set on workspace-scoped routes. */
  workspaceId?: string | undefined;
}

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Workspace role of the current user, as computed inside withRlsContext. */
export async function currentWorkspaceRole(
  tx: Transaction,
): Promise<"owner" | "admin" | "agent" | null> {
  const result = await tx.execute<{ role: string | null }>(
    sql`SELECT app_current_workspace_role() AS role`,
  );
  const role = result.rows[0]?.role ?? null;
  return role === "owner" || role === "admin" || role === "agent" ? role : null;
}

/**
 * Runs `fn` in a transaction that switches to guidesk_app and sets the request context used by
 * RLS policies (research R4, T014). On workspace routes it also sets the caller's role there. Settings are transaction-scoped (`SET LOCAL` semantics), so a
 * pooled connection never carries one request's context into the next.
 */
export async function withRlsContext<T>(
  db: Database,
  context: RlsContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!context.userId) {
    throw new Error("withRlsContext requires a userId");
  }
  if (context.workspaceId !== undefined && !UUID_PATTERN.test(context.workspaceId)) {
    throw new Error("withRlsContext requires workspaceId to be a UUID");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`));
    await tx.execute(
      sql`SELECT set_config('app.user_id', ${context.userId}, true), set_config('app.workspace_id', ${context.workspaceId ?? ""}, true)`,
    );
    if (context.workspaceId !== undefined) {
      // The role comes from the caller's own membership row (visible through membership_read),
      // so policies never trust a role supplied by the application.
      await tx.execute(
        sql`SELECT set_config('app.workspace_role', COALESCE((SELECT role FROM membership WHERE workspace_id = ${context.workspaceId}::uuid AND user_id = ${context.userId}), ''), true)`,
      );
    }
    return fn(tx);
  });
}
