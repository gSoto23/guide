import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, sql } from "drizzle-orm";
import QRCode from "qrcode";
import type { ShareOverview } from "@guidesk/contracts";
import { guide, guideLink, guideOpenDaily, property, type DbHandle } from "@guidesk/db";
import {
  encodePropertyLinkId,
  PROPERTY_LINK_BYTES,
  scheduledMessageTemplate,
  todayIn,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";
import type { Caller } from "../guides/guide-view.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { StayLinksService } from "./stay-links.service.js";
import { StayMessagesService } from "./stay-messages.service.js";

export interface ShareTarget {
  propertyId: string;
  propertyName: string;
  timeZone: string;
  checkInTime: string | null;
  checkoutTime: string | null;
  guideId: string;
  published: boolean;
  requireConfirmationCode: boolean;
}

const isManager = (caller: Caller) => caller.role === "owner" || caller.role === "admin";

/** A safe file name for downloads: letters, digits, and hyphens only. */
export function fileSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "guide";
}

/**
 * The Share screen (feature 004 US1, FR-037 to FR-044, research R14): the property link, its QR
 * code, the scheduled-message template, and, for owners and admins, the settings and stays.
 */
@Injectable()
export class ShareService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
    private readonly stayLinks: StayLinksService,
    private readonly stayMessages: StayMessagesService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  guideUrl(path: string): string {
    return `${this.config.GUIDE_URL.replace(/\/$/, "")}${path}`;
  }

  /** The property and its guide as the member's request sees them (RLS), or 404. */
  async target(workspaceId: string, propertyId: string): Promise<ShareTarget> {
    const [row] = await this.tx
      .select({
        propertyId: property.id,
        propertyName: property.name,
        timeZone: property.timeZone,
        checkInTime: property.checkInTime,
        checkoutTime: property.checkoutTime,
        guideId: guide.id,
        status: guide.status,
        publishedVersionId: guide.publishedVersionId,
        requireConfirmationCode: guide.requireConfirmationCode,
      })
      .from(property)
      .innerJoin(guide, eq(guide.propertyId, property.id))
      .where(
        and(
          eq(property.id, propertyId),
          eq(property.workspaceId, workspaceId),
          eq(property.status, "active"),
        ),
      )
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "property", propertyId);
    }
    return {
      propertyId: row.propertyId,
      propertyName: row.propertyName,
      timeZone: row.timeZone ?? "UTC",
      checkInTime: row.checkInTime,
      checkoutTime: row.checkoutTime,
      guideId: row.guideId,
      published: row.status === "published" && row.publishedVersionId !== null,
      requireConfirmationCode: row.requireConfirmationCode,
    };
  }

  /**
   * The active property link, created on first need in the system context (agents can open the
   * Share screen before an owner has), after the request context confirmed the property.
   */
  async ensurePropertyLink(
    workspaceId: string,
    propertyId: string,
    createdBy: string | null,
  ): Promise<{ publicId: string; createdAt: Date }> {
    const existing = await this.activeLink(workspaceId, propertyId);
    if (existing) return existing;
    await this.handle.db
      .insert(guideLink)
      .values({
        workspaceId,
        propertyId,
        publicId: encodePropertyLinkId(randomBytes(PROPERTY_LINK_BYTES)),
        createdBy,
      })
      .onConflictDoNothing();
    const created = await this.activeLink(workspaceId, propertyId);
    if (!created) throw new Error("Property link could not be created");
    return created;
  }

  private async activeLink(workspaceId: string, propertyId: string) {
    const [row] = await this.handle.db
      .select({ publicId: guideLink.publicId, createdAt: guideLink.createdAt })
      .from(guideLink)
      .where(
        and(
          eq(guideLink.workspaceId, workspaceId),
          eq(guideLink.propertyId, propertyId),
          eq(guideLink.status, "active"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async overview(caller: Caller, workspaceId: string, propertyId: string): Promise<ShareOverview> {
    const target = await this.target(workspaceId, propertyId);
    const manager = isManager(caller);
    const base: ShareOverview = {
      published: target.published,
      propertyName: target.propertyName,
      propertyLink: null,
      opensLast30Days: 0,
      templates: null,
      ...(manager ? { settings: { requireConfirmationCode: target.requireConfirmationCode } } : {}),
    };
    if (!target.published) return manager ? { ...base, stays: [] } : base;
    const link = await this.ensurePropertyLink(workspaceId, propertyId, caller.userId);
    const url = this.guideUrl(`/g/${link.publicId}`);
    const since = new Date(`${todayIn(target.timeZone)}T00:00:00Z`);
    since.setUTCDate(since.getUTCDate() - 29);
    const [opens] = await this.tx
      .select({ total: sql<number>`coalesce(sum(${guideOpenDaily.opens}), 0)::int` })
      .from(guideOpenDaily)
      .where(
        and(
          eq(guideOpenDaily.propertyId, propertyId),
          gte(guideOpenDaily.day, since.toISOString().slice(0, 10)),
        ),
      );
    const input = { propertyName: target.propertyName, propertyLink: url };
    return {
      ...base,
      propertyLink: { url, createdAt: link.createdAt.toISOString() },
      opensLast30Days: opens?.total ?? 0,
      templates: {
        es: scheduledMessageTemplate("es", input),
        en: scheduledMessageTemplate("en", input),
      },
      ...(manager ? { stays: await this.stayLinks.list(workspaceId, target) } : {}),
    };
  }

  /** Replaces the property link; the old one and printed QR codes stop working (FR-019). */
  async regeneratePropertyLink(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
  ): Promise<ShareOverview["propertyLink"]> {
    const target = await this.target(workspaceId, propertyId);
    if (!target.published) throw new ApiProblem(409, "guide_not_published");
    await this.ensurePropertyLink(workspaceId, propertyId, caller.userId);
    // Request context: RLS allows owners and admins of an active workspace only.
    const replaced = await this.tx
      .update(guideLink)
      .set({ status: "replaced", replacedAt: new Date(), replacedBy: caller.userId })
      .where(
        and(
          eq(guideLink.workspaceId, workspaceId),
          eq(guideLink.propertyId, propertyId),
          eq(guideLink.status, "active"),
        ),
      )
      .returning({ id: guideLink.id });
    if (replaced.length === 0) throw new ApiProblem(409, "conflict");
    const publicId = encodePropertyLinkId(randomBytes(PROPERTY_LINK_BYTES));
    const [created] = await this.tx
      .insert(guideLink)
      .values({ workspaceId, propertyId, publicId, createdBy: caller.userId })
      .returning({ createdAt: guideLink.createdAt });
    await this.securityLog.record({
      type: "guide.property_link_regenerated",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "property",
      targetId: propertyId,
      metadata: { propertyId },
    });
    return {
      url: this.guideUrl(`/g/${publicId}`),
      createdAt: (created?.createdAt ?? new Date()).toISOString(),
    };
  }

  /** The property link's QR code as SVG or PNG, error correction M (research R14). */
  async qr(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    format: "svg" | "png",
  ): Promise<{ body: string | Buffer; fileName: string }> {
    const target = await this.target(workspaceId, propertyId);
    if (!target.published) throw new ApiProblem(409, "guide_not_published");
    const link = await this.ensurePropertyLink(workspaceId, propertyId, caller.userId);
    const url = this.guideUrl(`/g/${link.publicId}`);
    const fileName = `${fileSlug(target.propertyName)}-guide-qr.${format}`;
    const options = { errorCorrectionLevel: "M" as const, margin: 2 };
    if (format === "svg") {
      return { body: await QRCode.toString(url, { ...options, type: "svg" }), fileName };
    }
    return { body: await QRCode.toBuffer(url, { ...options, type: "png", width: 1024 }), fileName };
  }

  async copyStayLink(caller: Caller, workspaceId: string, propertyId: string, stayId: string) {
    const target = await this.target(workspaceId, propertyId);
    return this.stayLinks.copy(caller, workspaceId, target, stayId);
  }

  async regenerateStayLink(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    stayId: string,
  ) {
    const target = await this.target(workspaceId, propertyId);
    return this.stayLinks.regenerate(caller, workspaceId, target, stayId);
  }

  async revokeStayLink(caller: Caller, workspaceId: string, propertyId: string, stayId: string) {
    const target = await this.target(workspaceId, propertyId);
    await this.stayLinks.revoke(caller, workspaceId, target, stayId);
  }

  /** Turns the confirmation code on or off for the property (FR-033, FR-052). */
  async setSettings(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    requireConfirmationCode: boolean,
  ): Promise<{ requireConfirmationCode: boolean }> {
    const target = await this.target(workspaceId, propertyId);
    if (target.requireConfirmationCode !== requireConfirmationCode) {
      await this.tx
        .update(guide)
        .set({ requireConfirmationCode })
        .where(and(eq(guide.id, target.guideId), eq(guide.workspaceId, workspaceId)));
      if (requireConfirmationCode) await this.stayLinks.ensureCodes(workspaceId, propertyId);
      await this.securityLog.record({
        type: "guide.confirmation_changed",
        outcome: "success",
        actorUserId: caller.userId,
        workspaceId,
        targetType: "property",
        targetId: propertyId,
        metadata: { propertyId, required: requireConfirmationCode },
      });
    }
    return { requireConfirmationCode };
  }

  async stayMessage(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    stayId: string,
    language: "es" | "en",
    withValues: boolean,
  ) {
    const target = await this.target(workspaceId, propertyId);
    return this.stayMessages.message(caller, workspaceId, target, stayId, language, withValues);
  }
}
