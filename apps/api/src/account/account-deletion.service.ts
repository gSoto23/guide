import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { accountDeletionRequest, session, user, type DbHandle } from "@guidesk/db";
import { renderAccountDeletionScheduled, toEmailLocale } from "@guidesk/emails";
import { ApiProblem } from "../common/problem.js";
import { DB_HANDLE } from "../database/database.module.js";
import { OutboxService } from "../notifications/outbox.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Account deletion (FR-028, T095): scheduled for 30 days, cancelled by signing in again, and
 * completed by the worker's purge job. Blocked while the user owns a workspace with others.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly securityLog: SecurityLogService,
    private readonly outbox: OutboxService,
  ) {}

  async schedule(userId: string): Promise<{ purgeAfter: string }> {
    const shared = await this.handle.db.execute(sql`
      SELECT 1 FROM membership own
      WHERE own.user_id = ${userId} AND own.role = 'owner'
        AND EXISTS (
          SELECT 1 FROM membership other
          WHERE other.workspace_id = own.workspace_id AND other.user_id <> ${userId}
        )
      LIMIT 1
    `);
    if (shared.rows.length > 0) {
      throw new ApiProblem(
        409,
        "owns_shared_workspace",
        "Transfer ownership or delete the workspaces you share with others first.",
      );
    }
    const purgeAfter = new Date(Date.now() + GRACE_MS);
    // Workspaces the user owns go with the account. An invitation accepted meanwhile would block
    // the purge, so open ones stop working now (T103).
    await this.handle.db.execute(sql`
      UPDATE invitation SET status = 'revoked'
      WHERE status = 'pending'
        AND workspace_id IN (
          SELECT workspace_id FROM membership WHERE user_id = ${userId} AND role = 'owner'
        )
    `);
    await this.handle.db
      .insert(accountDeletionRequest)
      .values({ userId, purgeAfter, status: "scheduled" })
      .onConflictDoUpdate({
        target: accountDeletionRequest.userId,
        set: { requestedAt: new Date(), purgeAfter, status: "scheduled" },
      });
    await this.handle.db
      .update(user)
      .set({ deletedAt: new Date(), purgeAfter })
      .where(eq(user.id, userId));
    await this.securityLog.record({
      type: "account.deletion_scheduled",
      outcome: "success",
      actorUserId: userId,
      metadata: { purge_after: purgeAfter.toISOString() },
    });
    const [owner] = await this.handle.db
      .select({ email: user.email, language: user.preferredLanguage })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (owner) {
      const rendered = await renderAccountDeletionScheduled(
        toEmailLocale(owner.language),
        purgeAfter,
      );
      await this.outbox.enqueueEmail({
        to: owner.email,
        ...rendered,
        template: "account.deletion_scheduled",
      });
    }
    // Signed out everywhere; signing in again cancels the deletion.
    await this.handle.db.delete(session).where(eq(session.userId, userId));
    return { purgeAfter: purgeAfter.toISOString() };
  }

  /** Called on every sign-in: coming back within 30 days keeps the account. */
  async cancelIfScheduled(userId: string): Promise<void> {
    const cancelled = await this.handle.db
      .update(accountDeletionRequest)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(accountDeletionRequest.userId, userId),
          eq(accountDeletionRequest.status, "scheduled"),
        ),
      )
      .returning({ userId: accountDeletionRequest.userId });
    if (cancelled.length === 0) return;
    await this.handle.db
      .update(user)
      .set({ deletedAt: null, purgeAfter: null })
      .where(eq(user.id, userId));
    await this.securityLog.record({
      type: "account.deletion_cancelled",
      outcome: "success",
      actorUserId: userId,
    });
  }
}
