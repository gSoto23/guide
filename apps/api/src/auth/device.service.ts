import { createHmac } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq } from "drizzle-orm";
import { knownDevice, session, user, type DbHandle } from "@guidesk/db";
import { renderNewDevice, toEmailLocale } from "@guidesk/emails";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { OutboxService } from "../notifications/outbox.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { DEVICE_COOKIE, isValidDeviceId } from "./device-cookie.js";
import { describeUserAgent } from "./user-agent.js";
import { EDGE_SECRET_HEADER, safeEqual } from "../common/edge-headers.js";

function cookieValue(headers: Headers | undefined, name: string): string | null {
  const raw = headers?.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** New-device detection and session device details (FR-012, research R7, T058). */
@Injectable()
export class DeviceService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly outbox: OutboxService,
    private readonly securityLog: SecurityLogService,
  ) {}

  label(headers: Headers | undefined): string {
    return describeUserAgent(headers?.get("user-agent"));
  }

  /** City and country from CloudFront, trusted only with the edge secret. */
  location(headers: Headers | undefined): string | null {
    const secret = this.config.EDGE_SHARED_SECRET;
    const provided = headers?.get(EDGE_SECRET_HEADER);
    if (!secret || !provided || !safeEqual(provided, secret)) return null;
    const city = headers?.get("cloudfront-viewer-city");
    const country = headers?.get("cloudfront-viewer-country");
    return [city, country].filter(Boolean).join(", ") || null;
  }

  async handleSignIn(
    sessionRow: { id: string; userId: string },
    headers: Headers | undefined,
  ): Promise<void> {
    const deviceId = cookieValue(headers, DEVICE_COOKIE);
    const label = this.label(headers);
    const location = this.location(headers);
    const deviceIdHash = isValidDeviceId(deviceId)
      ? createHmac("sha256", this.config.BETTER_AUTH_SECRET).update(deviceId).digest("hex")
      : null;

    await this.handle.db
      .update(session)
      .set({ deviceIdHash, deviceLabel: label, approxLocation: location })
      .where(eq(session.id, sessionRow.id));

    await this.securityLog.record({
      type: "signin.succeeded",
      outcome: "success",
      actorUserId: sessionRow.userId,
      userAgentFamily: label,
      approxLocation: location,
    });

    if (!deviceIdHash) return;
    const db = this.handle.db;
    const [known] = await db
      .select({ id: knownDevice.id })
      .from(knownDevice)
      .where(
        and(eq(knownDevice.userId, sessionRow.userId), eq(knownDevice.deviceIdHash, deviceIdHash)),
      )
      .limit(1);
    if (known) {
      await db
        .update(knownDevice)
        .set({ lastSeenAt: new Date() })
        .where(eq(knownDevice.id, known.id));
      return;
    }
    const [prior] = await db
      .select({ n: count() })
      .from(knownDevice)
      .where(eq(knownDevice.userId, sessionRow.userId));
    await db
      .insert(knownDevice)
      .values({ userId: sessionRow.userId, deviceIdHash, label })
      .onConflictDoNothing();
    // The very first device of an account is not "new"; alerts start from the second one.
    if (Number(prior?.n ?? 0) === 0) return;

    await this.securityLog.record({
      type: "signin.new_device",
      outcome: "success",
      actorUserId: sessionRow.userId,
      userAgentFamily: label,
      approxLocation: location,
    });
    const [owner] = await db
      .select({ email: user.email, language: user.preferredLanguage })
      .from(user)
      .where(eq(user.id, sessionRow.userId))
      .limit(1);
    if (!owner) return;
    const email = await renderNewDevice(toEmailLocale(owner.language), {
      device: label,
      location,
      at: new Date(),
    });
    await this.outbox.enqueueEmail({ to: owner.email, ...email, template: "auth.new_device" });
  }
}
