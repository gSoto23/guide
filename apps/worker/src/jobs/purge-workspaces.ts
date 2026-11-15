import type { SqlRunner } from "./invitations.js";

/** Daily permanent deletion of workspaces past their 30-day restore window (FR-027, T094). */
export const PURGE_WORKSPACES_QUEUE = "workspaces.purge";
export const PURGE_WORKSPACES_CRON = "30 3 * * *";

export function createPurgeWorkspacesHandler(db: SqlRunner) {
  return async (): Promise<void> => {
    // purge_due_workspaces() deletes each due workspace and records workspace.purged.
    await db.executeSql("SELECT * FROM purge_due_workspaces()");
  };
}
