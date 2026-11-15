/** Daily invitation housekeeping (spec 001 US3, data model §5, T076). */
export const EXPIRE_INVITATIONS_QUEUE = "invitations.expire";

/** Every day at 03:15 UTC. */
export const EXPIRE_INVITATIONS_CRON = "15 3 * * *";

/** The SQL runner pg-boss exposes (`boss.getDb()`), on the owner connection. */
export interface SqlRunner {
  executeSql(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Marks pending invitations past their 7-day expiry as expired, and drops idempotency keys older
 * than a day. Reads already treat an overdue invitation as expired; this keeps the table tidy and
 * the history accurate.
 */
export function createExpireInvitationsHandler(db: SqlRunner) {
  return async (): Promise<void> => {
    await db.executeSql(
      "UPDATE invitation SET status = 'expired' WHERE status = 'pending' AND expires_at <= now()",
    );
    await db.executeSql("DELETE FROM idempotency_key WHERE created_at < now() - interval '1 day'");
  };
}
