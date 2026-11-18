import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { GuestSession, StayExchangeResponse } from "@guidesk/contracts";
import { guide, guideLink, guideSession, property, stay, stayLink, workspace } from "@guidesk/db";
import { isStayToken, lockState, STAY_LINK_DEVICE_LIMIT, type LockContext } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import {
  GuestContext,
  readCookie,
  sha256Hex,
  unavailable,
  type GuestTarget,
} from "./guest-context.js";
import { hashToken } from "./stay-link-secrets.js";

/** Token exchanges per network address per hour (research R17). */
export const EXCHANGES_PER_HOUR = 20;
const LAST_SEEN_EVERY_MS = 5 * 60 * 1000;

export interface GuestDevice {
  sessionId: string;
  stayLinkId: string;
  stayId: string;
  verified: boolean;
  lockedUntil: Date | null;
  context: LockContext;
}

/**
 * Guest device sessions (feature 004 research R5, R6, SEC-02): a stay token is exchanged once
 * per device for a host-only, HttpOnly cookie; only the cookie's hash is stored. Whether the
 * device may see codes is computed on every request from the stay, so revocation, cancellation,
 * date changes, and the end of the window apply at once.
 */
@Injectable()
export class GuestSessions {
  constructor(
    private readonly context: GuestContext,
    private readonly rateLimit: RateLimitService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  get cookieName(): string {
    return this.config.GUIDE_URL.startsWith("https://") ? "__Host-guidesk_guest" : "guidesk_guest";
  }

  private cookie(value: string, maxAgeSeconds: number): string {
    const secure = this.config.GUIDE_URL.startsWith("https://");
    return [
      `${this.cookieName}=${value}`,
      "Path=/",
      `Max-Age=${Math.max(60, Math.floor(maxAgeSeconds))}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(secure ? ["Secure"] : []),
    ].join("; ");
  }

  cookieValue(header: string | undefined): string | undefined {
    const value = readCookie(header, this.cookieName);
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
  }

  /** Exchanges a stay token for a device session (research R5). */
  async exchange(
    token: string,
    ipKey: string,
    cookieHeader: string | undefined,
  ): Promise<{ body: StayExchangeResponse; setCookie?: string }> {
    const limit = await this.rateLimit.consume(
      `guest-exchange:ip:${ipKey}`,
      EXCHANGES_PER_HOUR,
      3600,
    );
    if (!limit.allowed) {
      throw new ApiProblem(429, "rate_limited", undefined, {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    if (!isStayToken(token)) throw unavailable();
    const db = this.context.db;
    const [row] = await db
      .select({
        linkId: stayLink.id,
        linkStatus: stayLink.status,
        workspaceId: stayLink.workspaceId,
        propertyId: stayLink.propertyId,
        stay,
        timeZone: property.timeZone,
        checkInTime: property.checkInTime,
        checkoutTime: property.checkoutTime,
        publicId: guideLink.publicId,
      })
      .from(stayLink)
      .innerJoin(stay, eq(stay.id, stayLink.stayId))
      .innerJoin(property, and(eq(property.id, stayLink.propertyId), eq(property.status, "active")))
      .innerJoin(
        workspace,
        and(eq(workspace.id, stayLink.workspaceId), eq(workspace.status, "active")),
      )
      .innerJoin(
        guide,
        and(
          eq(guide.propertyId, stayLink.propertyId),
          eq(guide.status, "published"),
          sql`${guide.publishedVersionId} IS NOT NULL`,
        ),
      )
      .innerJoin(
        guideLink,
        and(eq(guideLink.propertyId, stayLink.propertyId), eq(guideLink.status, "active")),
      )
      .where(eq(stayLink.tokenHash, hashToken(token)))
      .limit(1);
    if (!row) throw unavailable();
    const guideUrl = `/g/${row.publicId}`;
    const context: LockContext = {
      link: { status: row.linkStatus },
      stay: row.stay,
      property: {
        timeZone: row.timeZone ?? "UTC",
        checkInTime: row.checkInTime,
        checkoutTime: row.checkoutTime,
      },
    };
    const state = lockState(context, new Date());
    if (state.state === "ended") return { body: { guideUrl, notice: "ended" } };
    const existing = this.cookieValue(cookieHeader);
    if (existing) {
      const [reused] = await db
        .select({ id: guideSession.id })
        .from(guideSession)
        .where(
          and(
            eq(guideSession.cookieHash, sha256Hex(existing)),
            eq(guideSession.stayLinkId, row.linkId),
          ),
        )
        .limit(1);
      if (reused) return { body: { guideUrl, notice: null } };
    }
    const [devices] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(guideSession)
      .where(eq(guideSession.stayLinkId, row.linkId));
    if ((devices?.count ?? 0) >= STAY_LINK_DEVICE_LIMIT) {
      return { body: { guideUrl, notice: "device_limit" } };
    }
    const value = randomBytes(32).toString("base64url");
    await db.insert(guideSession).values({
      workspaceId: row.workspaceId,
      propertyId: row.propertyId,
      stayLinkId: row.linkId,
      cookieHash: sha256Hex(value),
    });
    // Feature 010 (research R4): the stay's first guide open, kept after links and sessions go.
    await db
      .update(stay)
      .set({ guideOpenedAt: new Date() })
      .where(and(eq(stay.id, row.stay.id), isNull(stay.guideOpenedAt)));
    const maxAge = (state.window!.closesAt.getTime() - Date.now()) / 1000;
    return { body: { guideUrl, notice: null }, setCookie: this.cookie(value, maxAge) };
  }

  /** The device's session for this guide, or null (a session of another property counts as none). */
  async device(target: GuestTarget, cookieHeader: string | undefined): Promise<GuestDevice | null> {
    const value = this.cookieValue(cookieHeader);
    if (!value) return null;
    const [row] = await this.context.db
      .select({
        sessionId: guideSession.id,
        lastSeenAt: guideSession.lastSeenAt,
        verifiedAt: guideSession.verifiedAt,
        stayLinkId: stayLink.id,
        linkStatus: stayLink.status,
        lockedUntil: stayLink.lockedUntil,
        stay,
      })
      .from(guideSession)
      .innerJoin(stayLink, eq(stayLink.id, guideSession.stayLinkId))
      .innerJoin(stay, eq(stay.id, stayLink.stayId))
      .where(
        and(
          eq(guideSession.cookieHash, sha256Hex(value)),
          eq(guideSession.workspaceId, target.workspaceId),
          eq(guideSession.propertyId, target.propertyId),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_EVERY_MS) {
      await this.context.db
        .update(guideSession)
        .set({ lastSeenAt: new Date() })
        .where(eq(guideSession.id, row.sessionId));
    }
    return {
      sessionId: row.sessionId,
      stayLinkId: row.stayLinkId,
      stayId: row.stay.id,
      verified: row.verifiedAt !== null,
      lockedUntil: row.lockedUntil,
      context: {
        link: { status: row.linkStatus },
        stay: row.stay,
        property: {
          timeZone: target.timeZone,
          checkInTime: target.checkInTime,
          checkoutTime: target.checkoutTime,
        },
      },
    };
  }

  /** What the page script needs (contracts/http-api.md `GuestSession`); never guest data. */
  async session(publicId: string, cookieHeader: string | undefined): Promise<GuestSession> {
    const target = await this.context.byPublicId(publicId);
    const device = await this.device(target, cookieHeader);
    const state = lockState(device?.context ?? null, new Date());
    const base: GuestSession = {
      state: state.state,
      codeRequired: target.requireConfirmationCode,
      verified: device?.verified ?? false,
      lockedUntil:
        device?.lockedUntil && device.lockedUntil > new Date()
          ? device.lockedUntil.toISOString()
          : null,
    };
    if (!device || !state.window || (state.state !== "before" && state.state !== "inside")) {
      return base;
    }
    return {
      ...base,
      stay: {
        checkInDate: device.context.stay.checkInDate,
        checkoutDate: device.context.stay.checkoutDate,
        checkInTime: state.window.checkInTime,
        checkoutTime: state.window.checkoutTime,
      },
      opensAt: state.window.opensAt.toISOString(),
      closesAt: state.window.closesAt.toISOString(),
      timeZone: target.timeZone,
    };
  }
}
