import { createHmac } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, lte, ne } from "drizzle-orm";
import { invitation, session, usedTotpCode, user, verification, type DbHandle } from "@guidesk/db";
import { renderFactorChanged, toEmailLocale } from "@guidesk/emails";
import { isStepUpFresh, type SecurityEventType } from "@guidesk/domain";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { OutboxService } from "../notifications/outbox.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { TenancyService } from "../tenancy/tenancy.service.js";
import { AssuranceService, type Assurance, type AuthMethod } from "./assurance.service.js";
import type {
  AuthEventHandlers,
  FactorChange,
  FactorGate,
  SecondFactorMethod,
} from "./auth-events.js";
import { DeviceService } from "./device.service.js";
import { hashInvitationToken } from "../tenancy/invitation-token.js";
import { invitationTokenFrom } from "./invitation-signup.js";
import { LockoutNoticeService } from "./lockout-notice.service.js";
import { emailKey, LockoutService, userKey } from "./lockout.service.js";

const FACTOR_EVENTS: Record<FactorChange, SecurityEventType> = {
  passkey_added: "passkey.added",
  passkey_removed: "passkey.removed",
  totp_enabled: "mfa.enrolled",
  totp_disabled: "mfa.removed",
};

/** Sign-in code sends per email per hour (research R8, AC-SEC-008). */
const CODE_SENDS_PER_HOUR = 5;
/** An accepted authenticator code stays blocked past its validity window (period 30 s, ±1 step). */
const USED_TOTP_TTL_MS = 2 * 60 * 1000;
const SECOND_FACTOR_METHODS = new Set<AuthMethod | null>(["passkey", "totp"]);

/** Implements what Better Auth hooks report (T039, T058, T059, T061, T064, T103). */
@Injectable()
export class AuthEventsService implements AuthEventHandlers {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly tenancy: TenancyService,
    private readonly assurance: AssuranceService,
    private readonly devices: DeviceService,
    private readonly lockout: LockoutService,
    private readonly lockoutNotice: LockoutNoticeService,
    private readonly outbox: OutboxService,
    private readonly securityLog: SecurityLogService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private async findUser(where: { email?: string; id?: string }) {
    const condition = where.email
      ? eq(user.email, where.email.trim().toLowerCase())
      : eq(user.id, where.id ?? "");
    const [row] = await this.handle.db
      .select({ id: user.id, email: user.email, language: user.preferredLanguage })
      .from(user)
      .where(condition)
      .limit(1);
    return row;
  }

  private totpHash(userId: string, code: string): string {
    return createHmac("sha256", this.config.BETTER_AUTH_SECRET)
      .update(`${userId}:${code}`)
      .digest("hex");
  }

  async onUserCreated(
    created: { id: string; email: string; name: string | null; preferredLanguage: string | null },
    headers: Headers | undefined,
  ) {
    // A sign-up from a valid invitation for this very email joins that workspace instead of
    // getting one of its own (FR-020). Anything else, including a forged cookie, gets one.
    if (!(await this.isInvitedSignUp(created.email, headers))) {
      await this.tenancy.createWorkspaceForNewUser(created);
    }
  }

  private async isInvitedSignUp(email: string, headers: Headers | undefined): Promise<boolean> {
    const token = invitationTokenFrom(headers);
    if (!token) return false;
    const [row] = await this.handle.db
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.tokenHash, hashInvitationToken(token)),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date()),
          eq(invitation.email, email.trim().toLowerCase()),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  assuranceOf(sessionId: string): Promise<Assurance> {
    return this.assurance.get(sessionId);
  }

  async onSessionCreated(
    created: { id: string; userId: string },
    method: AuthMethod | null,
    headers: Headers | undefined,
    rotatedFrom: Assurance | null,
  ) {
    if (method) {
      await this.assurance.recordSignIn(created.id, created.userId, method);
      await this.devices.handleSignIn(created, headers);
      return;
    }
    // A rotation is not a sign-in: no fresh authentication, no sign-in event (T103).
    await this.assurance.recordWithoutSignIn(created.id, created.userId, rotatedFrom);
  }

  isEmailLocked(email: string): Promise<boolean> {
    return this.lockout.isLocked(emailKey(email));
  }

  isUserLocked(userId: string): Promise<boolean> {
    return this.lockout.isLocked(userKey(userId));
  }

  async allowCodeSend(email: string): Promise<boolean> {
    // Counted whether or not the account exists, so the limit reveals nothing (AC-SEC-007).
    const result = await this.rateLimit.consume(
      `otp-send:${emailKey(email)}`,
      CODE_SENDS_PER_HOUR,
      3600,
    );
    return result.allowed;
  }

  async hasPendingSignInCode(email: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ id: verification.id })
      .from(verification)
      .where(
        and(
          eq(verification.identifier, `sign-in-otp-${email.trim().toLowerCase()}`),
          gt(verification.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async isStepUpFresh(sessionId: string): Promise<boolean> {
    const { strongAuthAt } = await this.assurance.get(sessionId);
    return isStepUpFresh(strongAuthAt);
  }

  async factorGate(current: { id: string; userId: string }): Promise<FactorGate> {
    const { strongAuthAt, method } = await this.assurance.get(current.id);
    if (!isStepUpFresh(strongAuthAt)) return "step_up_required";
    const factors = await this.assurance.factors(current.userId);
    if ((factors.hasPasskey || factors.totpEnabled) && !SECOND_FACTOR_METHODS.has(method)) {
      return "second_factor_required";
    }
    return "ok";
  }

  async isTotpCodeUsed(userId: string, code: string): Promise<boolean> {
    const [row] = await this.handle.db
      .select({ userId: usedTotpCode.userId })
      .from(usedTotpCode)
      .where(
        and(
          eq(usedTotpCode.userId, userId),
          eq(usedTotpCode.codeHash, this.totpHash(userId, code)),
          gt(usedTotpCode.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async afterEmailOtpSignIn(email: string, succeeded: boolean, counted: boolean) {
    const key = emailKey(email);
    if (succeeded) {
      await this.lockout.reset(key);
      return;
    }
    // Without a pending code there is nothing to guess, so the attempt can't lock the account:
    // otherwise anyone could keep a victim locked out (T103).
    if (!counted) return;
    const failure = await this.lockout.recordFailure(key);
    const account = await this.findUser({ email });
    if (!account) return; // Nothing is sent or logged per person for unknown emails (AC-SEC-007).
    await this.securityLog.record({
      type: "signin.failed",
      outcome: "failure",
      actorUserId: account.id,
      metadata: { method: "email_otp" },
    });
    if (failure.justLocked) {
      await this.lockoutNotice.notify(account.id, key, "email_otp");
    }
  }

  async afterTotpVerified(
    current: { id: string; userId: string },
    enabling: boolean,
    code: string,
    headers: Headers | undefined,
  ) {
    // Each authenticator code works once (ASVS 5.0 V6.5).
    const now = new Date();
    await this.handle.db
      .delete(usedTotpCode)
      .where(and(eq(usedTotpCode.userId, current.userId), lte(usedTotpCode.expiresAt, now)));
    await this.handle.db
      .insert(usedTotpCode)
      .values({
        userId: current.userId,
        codeHash: this.totpHash(current.userId, code),
        expiresAt: new Date(now.getTime() + USED_TOTP_TTL_MS),
      })
      .onConflictDoNothing();
    await this.lockout.reset(userKey(current.userId));
    if (enabling) {
      // Enrolling proves nothing about who is signed in, so it is not a step-up (T103).
      await this.afterFactorChanged(current.userId, "totp_enabled", headers);
      return;
    }
    await this.assurance.markStepUp(current.id, current.userId, "totp", true);
    await this.securityLog.record({
      type: "step_up.succeeded",
      outcome: "success",
      actorUserId: current.userId,
      metadata: { method: "totp" },
    });
  }

  async afterSecondFactorFailed(userId: string, method: SecondFactorMethod) {
    const key = userKey(userId);
    const failure = await this.lockout.recordFailure(key);
    await this.securityLog.record({
      type: "step_up.failed",
      outcome: "failure",
      actorUserId: userId,
      metadata: { method },
    });
    if (failure.justLocked) {
      await this.lockoutNotice.notify(userId, key, method);
    }
  }

  async afterBackupCodeUsed(current: { id: string; userId: string }) {
    await this.assurance.markStepUp(current.id, current.userId, "totp", true);
    await this.lockout.reset(userKey(current.userId));
    await this.securityLog.record({
      type: "recovery_code.used",
      outcome: "success",
      actorUserId: current.userId,
    });
  }

  async afterFactorChanged(
    userId: string,
    change: FactorChange,
    headers: Headers | undefined,
    keepSessionId?: string,
  ) {
    await this.securityLog.record({
      type: FACTOR_EVENTS[change],
      outcome: "success",
      actorUserId: userId,
    });
    if (keepSessionId) {
      // Removing a factor ends every other session, so an attacker's sessions don't survive
      // the clean-up (FR-013, SEC-05).
      await this.handle.db
        .delete(session)
        .where(and(eq(session.userId, userId), ne(session.id, keepSessionId)));
      await this.securityLog.record({
        type: "sessions.revoked_all",
        outcome: "success",
        actorUserId: userId,
        metadata: { reason: "factor_removed" },
      });
    }
    const account = await this.findUser({ id: userId });
    if (!account) return;
    const rendered = await renderFactorChanged(
      toEmailLocale(account.language),
      change,
      this.devices.label(headers),
    );
    await this.outbox.enqueueEmail({
      to: account.email,
      ...rendered,
      template: "auth.mfa_changed",
    });
  }

  async afterSessionsRevoked(userId: string, all: boolean) {
    await this.securityLog.record({
      type: all ? "sessions.revoked_all" : "session.revoked",
      outcome: "success",
      actorUserId: userId,
    });
  }
}
