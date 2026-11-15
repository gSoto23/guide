import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, ne, sql } from "drizzle-orm";
import { emailChangeRequest, session, user, type DbHandle } from "@guidesk/db";
import {
  maskEmail,
  renderEmailChangeCode,
  renderEmailChanged,
  toEmailLocale,
} from "@guidesk/emails";
import type { AuthSession, EmailAdapter } from "@guidesk/integrations";
import { LockoutNoticeService } from "../auth/lockout-notice.service.js";
import { LockoutService, MAX_FAILURES, userKey } from "../auth/lockout.service.js";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { EMAIL_ADAPTER } from "../email/email.module.js";
import { OutboxService } from "../notifications/outbox.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";

const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Email change (FR-029, T097): the new address proves itself with a one-time code; the old
 * address gets a notice; other sessions end. Whether the new address already has an account is
 * only revealed after its owner enters the code.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly rateLimit: RateLimitService,
    private readonly lockout: LockoutService,
    private readonly lockoutNotice: LockoutNoticeService,
    private readonly outbox: OutboxService,
    private readonly securityLog: SecurityLogService,
  ) {}

  private hash(code: string): string {
    return createHmac("sha256", this.config.BETTER_AUTH_SECRET)
      .update(`email-change:${code}`)
      .digest("hex");
  }

  async request(auth: AuthSession, newEmail: string): Promise<{ expiresAt: string }> {
    if (newEmail === auth.user.email.trim().toLowerCase()) {
      throw new ApiProblem(422, "validation_failed", "That is already your email.", {
        fields: { newEmail: ["Same as the current email"] },
      });
    }
    const limit = await this.rateLimit.consume(`email-change:${auth.user.id}`, 5, 3600);
    // Also per target address, so no account can flood someone else's inbox (AC-SEC-008, T103).
    const target = createHash("sha256").update(newEmail).digest("hex");
    const perAddress = limit.allowed
      ? await this.rateLimit.consume(`email-change:recipient:${target}`, 3, 3600)
      : limit;
    if (!limit.allowed || !perAddress.allowed) {
      throw new ApiProblem(429, "rate_limited", "Too many codes requested. Try again later.");
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.handle.db
      .insert(emailChangeRequest)
      .values({ userId: auth.user.id, newEmail, codeHash: this.hash(code), expiresAt })
      .onConflictDoUpdate({
        target: emailChangeRequest.userId,
        set: { newEmail, codeHash: this.hash(code), expiresAt, attempts: 0, createdAt: new Date() },
      });
    await this.securityLog.record({
      type: "email.change_requested",
      outcome: "success",
      actorUserId: auth.user.id,
    });
    // Sent inline, like sign-in codes: codes never sit in the queue.
    const rendered = await renderEmailChangeCode(toEmailLocale(auth.user.preferredLanguage), code);
    await this.email.send({ to: newEmail, ...rendered, template: "account.email_change_code" });
    return { expiresAt: expiresAt.toISOString() };
  }

  async confirm(auth: AuthSession, code: string): Promise<{ email: string }> {
    const key = userKey(auth.user.id);
    if (await this.lockout.isLocked(key)) {
      throw new ApiProblem(429, "rate_limited", "Too many attempts. Try again later.");
    }
    const [pending] = await this.handle.db
      .select()
      .from(emailChangeRequest)
      .where(eq(emailChangeRequest.userId, auth.user.id))
      .limit(1);
    if (!pending || pending.expiresAt <= new Date() || pending.attempts >= MAX_FAILURES) {
      throw new ApiProblem(410, "gone", "The code expired. Ask for a new one.");
    }
    const [counted] = await this.handle.db
      .update(emailChangeRequest)
      .set({ attempts: sql`${emailChangeRequest.attempts} + 1` })
      .where(
        and(
          eq(emailChangeRequest.userId, auth.user.id),
          sql`${emailChangeRequest.attempts} < ${MAX_FAILURES}`,
        ),
      )
      .returning({ attempts: emailChangeRequest.attempts });
    const matches =
      Boolean(counted) &&
      timingSafeEqual(Buffer.from(pending.codeHash, "hex"), Buffer.from(this.hash(code), "hex"));
    if (!matches) {
      const failure = await this.lockout.recordFailure(key);
      if (failure.justLocked) await this.lockoutNotice.notify(auth.user.id, key, "step_up");
      throw new ApiProblem(403, "forbidden", "The code is invalid.");
    }
    await this.handle.db
      .delete(emailChangeRequest)
      .where(eq(emailChangeRequest.userId, auth.user.id));
    const [taken] = await this.handle.db
      .select({ id: user.id })
      .from(user)
      .where(and(sql`lower(${user.email}) = ${pending.newEmail}`, ne(user.id, auth.user.id)))
      .limit(1);
    if (taken) {
      throw new ApiProblem(409, "email_in_use", "Another Guidesk account already uses this email.");
    }
    const oldEmail = auth.user.email;
    try {
      await this.handle.db
        .update(user)
        .set({ email: pending.newEmail, emailVerified: true })
        .where(eq(user.id, auth.user.id));
    } catch {
      throw new ApiProblem(409, "email_in_use", "Another Guidesk account already uses this email.");
    }
    await this.lockout.reset(key);
    // Every other session ends (FR-029, SEC-05).
    await this.handle.db
      .delete(session)
      .where(and(eq(session.userId, auth.user.id), ne(session.id, auth.session.id)));
    await this.securityLog.record({
      type: "email.changed",
      outcome: "success",
      actorUserId: auth.user.id,
    });
    const rendered = await renderEmailChanged(
      toEmailLocale(auth.user.preferredLanguage),
      maskEmail(pending.newEmail),
    );
    await this.outbox.enqueueEmail({
      to: oldEmail,
      ...rendered,
      template: "account.email_changed",
    });
    return { email: pending.newEmail };
  }
}
