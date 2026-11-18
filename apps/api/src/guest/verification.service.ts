import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { guideSession, stay, stayLink } from "@guidesk/db";
import {
  lockoutMinutes,
  lockState,
  nextLockoutCount,
  VERIFICATION_MAX_FAILURES,
  VERIFICATION_WINDOW_MINUTES,
} from "@guidesk/domain";
import { renderVerificationLocked } from "@guidesk/emails";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { MemberNotices } from "../tenancy/member-notices.js";
import { GuestContext } from "./guest-context.js";
import { GuestSessions } from "./sessions.service.js";
import { StayLinkSecrets } from "./stay-link-secrets.js";

const WINDOW_SECONDS = VERIFICATION_WINDOW_MINUTES * 60;

function locked(until: Date): ApiProblem {
  const seconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
  return new ApiProblem(423, "verification_locked", undefined, {
    retryAfterSeconds: seconds,
    details: { retryAfterSeconds: seconds },
  });
}

/**
 * Confirmation codes (feature 004 FR-033 to FR-035, research R8, SEC-03). Wrong codes count per
 * device session, per network address, and per stay; 5 in 15 minutes in any of them locks the
 * stay for 15 minutes, doubling for each later lockout up to 24 hours, with an alert to the owners
 * and admins. The code is compared in constant time and never logged.
 */
@Injectable()
export class GuestVerification {
  constructor(
    private readonly context: GuestContext,
    private readonly sessions: GuestSessions,
    private readonly secrets: StayLinkSecrets,
    private readonly rateLimit: RateLimitService,
    private readonly securityLog: SecurityLogService,
    private readonly notices: MemberNotices,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async verify(
    publicId: string,
    code: string,
    cookieHeader: string | undefined,
    ipKey: string,
  ): Promise<void> {
    const target = await this.context.byPublicId(publicId);
    const device = await this.sessions.device(target, cookieHeader);
    if (!device) throw new ApiProblem(401, "no_session");
    if (lockState(device.context, new Date()).state !== "inside") {
      throw new ApiProblem(409, "not_in_window");
    }
    if (!target.requireConfirmationCode || device.verified) return;
    const db = this.context.db;
    const [link] = await db
      .select({
        id: stayLink.id,
        dataKeyId: stayLink.dataKeyId,
        confirmationCiphertext: stayLink.confirmationCiphertext,
        lockedUntil: stayLink.lockedUntil,
      })
      .from(stayLink)
      .where(eq(stayLink.id, device.stayLinkId))
      .limit(1);
    if (!link?.confirmationCiphertext) throw new ApiProblem(409, "verification_required");
    if (link.lockedUntil && link.lockedUntil > new Date()) throw locked(link.lockedUntil);
    const expected = await this.secrets.code(
      target.workspaceId,
      link.id,
      link.dataKeyId,
      link.confirmationCiphertext,
    );
    if (this.secrets.matches(expected, code)) {
      await db
        .update(guideSession)
        .set({ verifiedAt: new Date() })
        .where(eq(guideSession.id, device.sessionId));
      await db
        .update(stayLink)
        .set({ failureCount: 0, failureWindowStartedAt: null })
        .where(eq(stayLink.id, link.id));
      return;
    }
    await this.failure(target.workspaceId, target.propertyId, target.propertyName, device, ipKey);
  }

  private async failure(
    workspaceId: string,
    propertyId: string,
    propertyName: string,
    device: { sessionId: string; stayLinkId: string; stayId: string },
    ipKey: string,
  ): Promise<never> {
    const bySession = await this.rateLimit.consume(
      `guest-verify:session:${device.sessionId}`,
      VERIFICATION_MAX_FAILURES - 1,
      WINDOW_SECONDS,
    );
    const byIp = await this.rateLimit.consume(
      `guest-verify:ip:${ipKey}`,
      VERIFICATION_MAX_FAILURES - 1,
      WINDOW_SECONDS,
    );
    // The stay's own count, across every device, in one locked row update.
    const outcome = await this.context.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          failureCount: stayLink.failureCount,
          windowStart: stayLink.failureWindowStartedAt,
          lockoutCount: stayLink.lockoutCount,
          lastLockoutAt: stayLink.lastLockoutAt,
          lockedUntil: stayLink.lockedUntil,
        })
        .from(stayLink)
        .where(eq(stayLink.id, device.stayLinkId))
        .for("update");
      const now = new Date();
      if (!row) return { lockedUntil: null, lockouts: 0, minutes: 0, failures: 0 };
      if (row.lockedUntil && row.lockedUntil > now) {
        return {
          lockedUntil: row.lockedUntil,
          lockouts: row.lockoutCount,
          minutes: 0,
          failures: 0,
        };
      }
      const fresh =
        !row.windowStart || now.getTime() - row.windowStart.getTime() > WINDOW_SECONDS * 1000;
      const failures = (fresh ? 0 : row.failureCount) + 1;
      const worst = Math.max(failures, bySession.count, byIp.count);
      if (worst >= VERIFICATION_MAX_FAILURES) {
        const lockouts = nextLockoutCount(row.lockoutCount, row.lastLockoutAt, now);
        const minutes = lockoutMinutes(lockouts);
        const lockedUntil = new Date(now.getTime() + minutes * 60_000);
        await tx
          .update(stayLink)
          .set({
            failureCount: 0,
            failureWindowStartedAt: null,
            lockedUntil,
            lockoutCount: lockouts,
            lastLockoutAt: now,
          })
          .where(eq(stayLink.id, device.stayLinkId));
        return { lockedUntil, lockouts, minutes, failures: worst };
      }
      await tx
        .update(stayLink)
        .set({
          failureCount: failures,
          failureWindowStartedAt: fresh ? now : row.windowStart,
        })
        .where(eq(stayLink.id, device.stayLinkId));
      return { lockedUntil: null, lockouts: row.lockoutCount, minutes: 0, failures: worst };
    });
    if (outcome.lockedUntil) {
      if (outcome.minutes > 0)
        await this.alert(workspaceId, propertyId, propertyName, device, outcome);
      throw locked(outcome.lockedUntil);
    }
    throw new ApiProblem(422, "invalid_code", undefined, {
      details: { attemptsLeft: Math.max(0, VERIFICATION_MAX_FAILURES - outcome.failures) },
    });
  }

  private async alert(
    workspaceId: string,
    propertyId: string,
    propertyName: string,
    device: { stayId: string },
    outcome: { minutes: number; lockouts: number },
  ): Promise<void> {
    await this.securityLog.record({
      type: "guide.verification_locked",
      outcome: "denied",
      workspaceId,
      targetType: "stay",
      targetId: device.stayId,
      metadata: {
        propertyId,
        stayId: device.stayId,
        lockedMinutes: outcome.minutes,
        lockouts: outcome.lockouts,
      },
    });
    const [dates] = await this.context.db
      .select({ checkInDate: stay.checkInDate, checkoutDate: stay.checkoutDate })
      .from(stay)
      .where(sql`${stay.id} = ${device.stayId}`)
      .limit(1);
    const portal = this.config.PORTAL_URL.replace(/\/$/, "");
    await this.notices.toOwnersAndAdmins(workspaceId, "guides.verification_locked", (locale) =>
      renderVerificationLocked(locale, {
        propertyName,
        checkInDate: dates?.checkInDate ?? "",
        checkoutDate: dates?.checkoutDate ?? "",
        lockedMinutes: outcome.minutes,
        lockouts: outcome.lockouts,
        shareLink: `${portal}/${locale}/properties/${propertyId}/share`,
      }),
    );
  }
}
