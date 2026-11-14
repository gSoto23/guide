import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { user, type DbHandle } from "@guidesk/db";
import { renderLockout, toEmailLocale } from "@guidesk/emails";
import { DB_HANDLE } from "../database/database.module.js";
import { OutboxService } from "../notifications/outbox.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { LOCK_MINUTES, LockoutService } from "./lockout.service.js";

export type LockScope = "email_otp" | "step_up" | "totp" | "recovery_code";

/**
 * Logs a lock and tells the account owner (AC-SEC-001). Every lock is logged; the email goes out
 * at most once per hour per lock key, so repeated locks can't flood an inbox (T103).
 */
@Injectable()
export class LockoutNoticeService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly lockout: LockoutService,
    private readonly outbox: OutboxService,
    private readonly securityLog: SecurityLogService,
  ) {}

  async notify(userId: string, key: string, scope: LockScope): Promise<void> {
    await this.securityLog.record({
      type: "signin.locked",
      outcome: "denied",
      actorUserId: userId,
      metadata: { minutes: LOCK_MINUTES, scope },
    });
    if (!(await this.lockout.claimNotice(key))) return;
    const [account] = await this.handle.db
      .select({ email: user.email, language: user.preferredLanguage })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (!account) return;
    const rendered = await renderLockout(toEmailLocale(account.language), LOCK_MINUTES);
    await this.outbox.enqueueEmail({ to: account.email, ...rendered, template: "auth.lockout" });
  }
}
