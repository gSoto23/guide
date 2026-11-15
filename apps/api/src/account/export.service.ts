import { Inject, Injectable } from "@nestjs/common";
import { asc, desc, eq } from "drizzle-orm";
import {
  knownDevice,
  membership,
  onboardingProfile,
  passkey,
  securityEvent,
  session,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";
import { SecurityLogService } from "../security-log/security-log.service.js";

/**
 * Personal-data export (FR-028, NFR-04, T096): the profile, memberships, onboarding answers,
 * sign-in methods (names only), sessions and devices, and the security events the user caused.
 * Never secrets: no tokens, codes, key material, or other people's data.
 */
@Injectable()
export class ExportService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly securityLog: SecurityLogService,
  ) {}

  async build(userId: string) {
    const db = this.handle.db;
    const [profile] = await db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        preferredLanguage: user.preferredLanguage,
        emailVerified: user.emailVerified,
        twoFactorEnabled: user.twoFactorEnabled,
        createdAt: user.createdAt,
      })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    const memberships = await db
      .select({
        workspaceId: membership.workspaceId,
        workspaceName: workspace.name,
        role: membership.role,
        joinedAt: membership.createdAt,
      })
      .from(membership)
      .innerJoin(workspace, eq(workspace.id, membership.workspaceId))
      .where(eq(membership.userId, userId))
      .orderBy(asc(membership.createdAt));
    const [onboarding] = await db
      .select()
      .from(onboardingProfile)
      .where(eq(onboardingProfile.userId, userId))
      .limit(1);
    const passkeys = await db
      .select({ name: passkey.name, createdAt: passkey.createdAt })
      .from(passkey)
      .where(eq(passkey.userId, userId));
    const sessions = await db
      .select({
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        device: session.deviceLabel,
        approxLocation: session.approxLocation,
      })
      .from(session)
      .where(eq(session.userId, userId));
    const devices = await db
      .select({
        label: knownDevice.label,
        firstSeenAt: knownDevice.firstSeenAt,
        lastSeenAt: knownDevice.lastSeenAt,
      })
      .from(knownDevice)
      .where(eq(knownDevice.userId, userId));
    const events = await db
      .select({
        occurredAt: securityEvent.occurredAt,
        type: securityEvent.type,
        outcome: securityEvent.outcome,
        workspaceId: securityEvent.workspaceId,
        approxLocation: securityEvent.approxLocation,
        userAgentFamily: securityEvent.userAgentFamily,
        metadata: securityEvent.metadata,
      })
      .from(securityEvent)
      .where(eq(securityEvent.actorUserId, userId))
      .orderBy(desc(securityEvent.occurredAt))
      .limit(5000);
    await this.securityLog.record({
      type: "account.export_downloaded",
      outcome: "success",
      actorUserId: userId,
    });
    return {
      format: "guidesk.personal-data.v1",
      exportedAt: new Date().toISOString(),
      profile: profile ?? null,
      onboarding: onboarding
        ? {
            propertiesBucket: onboarding.propertiesBucket,
            pms: onboarding.pms,
            pmsOther: onboarding.pmsOther,
            country: onboarding.country,
            path: onboarding.path,
            skipped: onboarding.skipped,
            answeredAt: onboarding.answeredAt,
          }
        : null,
      memberships,
      signInMethods: { passkeys },
      sessions,
      devices,
      securityEvents: events,
    };
  }
}
