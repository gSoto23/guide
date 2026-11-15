import { renderAccountDeleted, toEmailLocale } from "@guidesk/emails";
import type { EmailAdapter } from "@guidesk/integrations";

/** Daily completion of account deletions past their 30-day grace period (FR-028, T095). */
export const PURGE_ACCOUNTS_QUEUE = "accounts.purge";
export const PURGE_ACCOUNTS_CRON = "45 3 * * *";

export interface RowsRunner {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * For each due request: reads the address first, runs purge_account() (one transaction:
 * deletes solo-owned workspaces, pseudonymizes the actor in the security log, deletes the user),
 * then sends `account.deleted` to the last address. An account that still owns a shared workspace
 * is skipped and retried the next day.
 */
export function createPurgeAccountsHandler(db: RowsRunner, email: EmailAdapter) {
  return async (): Promise<void> => {
    const due = await db.executeSql(
      `SELECT r.user_id, u.email, u.preferred_language
       FROM account_deletion_request r JOIN "user" u ON u.id = r.user_id
       WHERE r.status = 'scheduled' AND r.purge_after <= now()
       ORDER BY r.purge_after LIMIT 100`,
    );
    for (const row of due.rows) {
      const userId = String(row.user_id);
      try {
        await db.executeSql("SELECT purge_account($1)", [userId]);
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (code === "GD410") continue;
        if (code === "GD409") {
          // Still owns a workspace with other members: retried daily; support follows up (T103).
          // The user ID is an opaque identifier, not personal data.
          console.warn(`account purge skipped for ${userId}: owns a shared workspace`);
          continue;
        }
        throw error;
      }
      const rendered = await renderAccountDeleted(toEmailLocale(row.preferred_language as string));
      await email.send({ to: String(row.email), ...rendered, template: "account.deleted" });
    }
  };
}
