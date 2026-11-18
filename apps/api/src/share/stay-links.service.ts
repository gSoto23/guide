import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { ShareStay, StayLinkCopy } from "@guidesk/contracts";
import { guideSession, securityEvent, stay, stayLink, type DbHandle } from "@guidesk/db";
import { STAY_LINK_DEVICE_LIMIT, stayLinkWorking, stayWindow } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";
import { StayLinkSecrets } from "../guest/stay-link-secrets.js";
import type { Caller } from "../guides/guide-view.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import type { ShareTarget } from "./share.service.js";

type StayRow = typeof stay.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string }; code?: string }) ?? {};
  return cause.code === "23505" || cause.cause?.code === "23505";
}

/**
 * Stay links on the Share screen (feature 004 US2, FR-020 to FR-022, FR-041, research R4). The
 * request context (owners and admins, RLS) reads and revokes; creating a link, which writes
 * ciphertexts the request role can't touch, runs in the system context after those checks.
 */
@Injectable()
export class StayLinksService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly requestDb: RequestDb,
    private readonly secrets: StayLinkSecrets,
    private readonly securityLog: SecurityLogService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  private url(token: string): string {
    return `${this.config.GUIDE_URL.replace(/\/$/, "")}/s/${token}`;
  }

  private window(target: ShareTarget, row: StayRow) {
    return stayWindow(
      {
        checkInDate: row.checkInDate,
        checkoutDate: row.checkoutDate,
        checkInTime: row.checkInTime,
        checkoutTime: row.checkoutTime,
      },
      {
        timeZone: target.timeZone,
        checkInTime: target.checkInTime,
        checkoutTime: target.checkoutTime,
      },
    );
  }

  /** Stays whose window has not closed, with their link status (FR-041). */
  async list(workspaceId: string, target: ShareTarget): Promise<ShareStay[]> {
    const now = new Date();
    const stays = (
      await this.tx
        .select()
        .from(stay)
        .where(
          and(
            eq(stay.workspaceId, workspaceId),
            eq(stay.propertyId, target.propertyId),
            ne(stay.status, "hidden"),
          ),
        )
    ).filter((row) => this.window(target, row).closesAt > now);
    if (stays.length === 0) return [];
    const links = await this.tx
      .select({
        id: stayLink.id,
        stayId: stayLink.stayId,
        status: stayLink.status,
        createdAt: stayLink.createdAt,
        lastCopiedAt: stayLink.lastCopiedAt,
        lockedUntil: stayLink.lockedUntil,
      })
      .from(stayLink)
      .where(
        and(
          eq(stayLink.propertyId, target.propertyId),
          inArray(
            stayLink.stayId,
            stays.map((row) => row.id),
          ),
        ),
      )
      .orderBy(desc(stayLink.createdAt));
    const latest = new Map<string, (typeof links)[number]>();
    for (const link of links) {
      const current = latest.get(link.stayId);
      if (!current || (current.status !== "active" && link.status === "active")) {
        latest.set(link.stayId, link);
      }
    }
    const linkIds = [...latest.values()].map((link) => link.id);
    const devices = linkIds.length
      ? await this.tx
          .select({
            stayLinkId: guideSession.stayLinkId,
            devices: sql<number>`count(*)::int`,
            firstOpenedAt: sql<Date>`min(${guideSession.createdAt})`,
          })
          .from(guideSession)
          .where(inArray(guideSession.stayLinkId, linkIds))
          .groupBy(guideSession.stayLinkId)
      : [];
    const shown = await this.handle.db
      .select({
        stayId: sql<string>`${securityEvent.metadata}->>'stayId'`,
        count: sql<number>`count(*)::int`,
      })
      .from(securityEvent)
      .where(
        and(
          eq(securityEvent.workspaceId, workspaceId),
          eq(securityEvent.type, "restricted_value.guest_revealed"),
          sql`${securityEvent.metadata}->>'propertyId' = ${target.propertyId}`,
        ),
      )
      .groupBy(sql`${securityEvent.metadata}->>'stayId'`);
    return stays
      .sort((a, b) => a.checkInDate.localeCompare(b.checkInDate))
      .map((row) => {
        const link = latest.get(row.id);
        const used = link ? devices.find((entry) => entry.stayLinkId === link.id) : undefined;
        const count = used?.devices ?? 0;
        let status: ShareStay["link"]["status"] = "not_created";
        if (link) {
          if (row.status !== "active") status = "ended";
          else if (link.status === "revoked") status = "revoked";
          else if (link.status === "active") {
            status = count >= STAY_LINK_DEVICE_LIMIT ? "device_limit" : "active";
          } else status = "ended";
        } else if (row.status !== "active") status = "ended";
        const firstOpened = used?.firstOpenedAt ? new Date(used.firstOpenedAt) : null;
        return {
          stayId: row.id,
          checkInDate: row.checkInDate,
          checkoutDate: row.checkoutDate,
          channel: row.channel,
          mayBeBlock: row.mayBeBlock,
          link: {
            status,
            devices: count,
            firstOpenedAt: firstOpened?.toISOString() ?? null,
            valuesShown: shown.find((entry) => entry.stayId === row.id)?.count ?? 0,
            lockedUntil: link?.lockedUntil?.toISOString() ?? null,
            lastCopiedAt: link?.lastCopiedAt?.toISOString() ?? null,
          },
        };
      });
  }

  /** The stay, if a link may be created or copied for it now (FR-020, FR-021). */
  private async eligibleStay(workspaceId: string, target: ShareTarget, stayId: string) {
    if (!target.published) throw new ApiProblem(409, "guide_not_published");
    const [row] = await this.tx
      .select()
      .from(stay)
      .where(
        and(
          eq(stay.id, stayId),
          eq(stay.workspaceId, workspaceId),
          eq(stay.propertyId, target.propertyId),
        ),
      )
      .limit(1);
    if (!row) throw new ApiProblem(404, "not_found");
    const window = this.window(target, row);
    const working = stayLinkWorking(
      {
        link: { status: "active" },
        stay: { ...row, status: row.status },
        property: {
          timeZone: target.timeZone,
          checkInTime: target.checkInTime,
          checkoutTime: target.checkoutTime,
        },
      },
      new Date(),
    );
    if (!working || window.closesAt <= new Date()) throw new ApiProblem(409, "stay_not_eligible");
    return row;
  }

  private async activeLink(workspaceId: string, stayId: string) {
    const [row] = await this.handle.db
      .select({
        id: stayLink.id,
        tokenCiphertext: stayLink.tokenCiphertext,
        confirmationCiphertext: stayLink.confirmationCiphertext,
        dataKeyId: stayLink.dataKeyId,
      })
      .from(stayLink)
      .where(
        and(
          eq(stayLink.workspaceId, workspaceId),
          eq(stayLink.stayId, stayId),
          eq(stayLink.status, "active"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async create(
    caller: Caller,
    workspaceId: string,
    target: ShareTarget,
    stayId: string,
  ): Promise<StayLinkCopy> {
    const id = randomUUID();
    const secrets = await this.secrets.create(workspaceId, id, target.requireConfirmationCode);
    try {
      await this.handle.db.insert(stayLink).values({
        id,
        workspaceId,
        propertyId: target.propertyId,
        stayId,
        tokenHash: secrets.tokenHash,
        tokenCiphertext: secrets.tokenCiphertext,
        confirmationCiphertext: secrets.confirmationCiphertext,
        dataKeyId: secrets.dataKeyId,
        createdBy: caller.userId,
        lastCopiedAt: new Date(),
        lastCopiedBy: caller.userId,
      });
    } catch (error) {
      // Another copy created it a moment ago: use that one.
      if (isUniqueViolation(error)) return this.reveal(workspaceId, stayId);
      throw error;
    }
    return { url: this.url(secrets.token), confirmationCode: secrets.confirmationCode };
  }

  private async reveal(workspaceId: string, stayId: string): Promise<StayLinkCopy> {
    const link = await this.activeLink(workspaceId, stayId);
    if (!link) throw new ApiProblem(409, "conflict");
    const token = await this.secrets.token(
      workspaceId,
      link.id,
      link.dataKeyId,
      link.tokenCiphertext,
    );
    const code = link.confirmationCiphertext
      ? await this.secrets.code(workspaceId, link.id, link.dataKeyId, link.confirmationCiphertext)
      : null;
    return { url: this.url(token), confirmationCode: code };
  }

  private async log(
    type: "guide.stay_link_copied" | "guide.stay_link_regenerated" | "guide.stay_link_revoked",
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    stayId: string,
  ): Promise<void> {
    await this.securityLog.record({
      type,
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "stay",
      targetId: stayId,
      metadata: { propertyId, stayId },
    });
  }

  /** Copies the stay's link, creating it on first copy (FR-020, FR-022). */
  async copy(
    caller: Caller,
    workspaceId: string,
    target: ShareTarget,
    stayId: string,
  ): Promise<StayLinkCopy> {
    await this.eligibleStay(workspaceId, target, stayId);
    const existing = await this.activeLink(workspaceId, stayId);
    let result: StayLinkCopy;
    if (existing) {
      result = await this.reveal(workspaceId, stayId);
      await this.tx
        .update(stayLink)
        .set({ lastCopiedAt: new Date(), lastCopiedBy: caller.userId })
        .where(and(eq(stayLink.id, existing.id), eq(stayLink.workspaceId, workspaceId)));
    } else {
      result = await this.create(caller, workspaceId, target, stayId);
    }
    await this.log("guide.stay_link_copied", caller, workspaceId, target.propertyId, stayId);
    return result;
  }

  /** Replaces the stay's link: the old one and its devices stop working (FR-021). */
  async regenerate(
    caller: Caller,
    workspaceId: string,
    target: ShareTarget,
    stayId: string,
  ): Promise<StayLinkCopy> {
    await this.eligibleStay(workspaceId, target, stayId);
    // System context, like the insert that follows: an uncommitted request-context update would
    // hold the unique index and block the new link's insert on the other connection.
    await this.handle.db
      .update(stayLink)
      .set({ status: "replaced", endedAt: new Date(), endedBy: caller.userId })
      .where(
        and(
          eq(stayLink.workspaceId, workspaceId),
          eq(stayLink.propertyId, target.propertyId),
          eq(stayLink.stayId, stayId),
          eq(stayLink.status, "active"),
        ),
      );
    const result = await this.create(caller, workspaceId, target, stayId);
    await this.log("guide.stay_link_regenerated", caller, workspaceId, target.propertyId, stayId);
    return result;
  }

  /** Revokes the stay's link; it shows the public guide with "This stay link has ended". */
  async revoke(
    caller: Caller,
    workspaceId: string,
    target: ShareTarget,
    stayId: string,
  ): Promise<void> {
    const revoked = await this.tx
      .update(stayLink)
      .set({ status: "revoked", endedAt: new Date(), endedBy: caller.userId })
      .where(
        and(
          eq(stayLink.workspaceId, workspaceId),
          eq(stayLink.propertyId, target.propertyId),
          eq(stayLink.stayId, stayId),
          eq(stayLink.status, "active"),
        ),
      )
      .returning({ id: stayLink.id });
    if (revoked.length === 0) throw new ApiProblem(404, "not_found");
    await this.log("guide.stay_link_revoked", caller, workspaceId, target.propertyId, stayId);
  }

  /**
   * Gives every active link of the property a confirmation code (FR-033): codes are created once
   * and kept, so turning the setting off and on again never changes a code already sent.
   */
  async ensureCodes(workspaceId: string, propertyId: string): Promise<void> {
    const links = await this.handle.db
      .select({
        id: stayLink.id,
        tokenCiphertext: stayLink.tokenCiphertext,
        dataKeyId: stayLink.dataKeyId,
      })
      .from(stayLink)
      .where(
        and(
          eq(stayLink.workspaceId, workspaceId),
          eq(stayLink.propertyId, propertyId),
          eq(stayLink.status, "active"),
          sql`${stayLink.confirmationCiphertext} IS NULL`,
        ),
      );
    for (const link of links) {
      const token = await this.secrets.token(
        workspaceId,
        link.id,
        link.dataKeyId,
        link.tokenCiphertext,
      );
      // Re-encrypt both under the active data key, so one data key ID covers the row.
      const secrets = await this.secrets.create(workspaceId, link.id, true, token);
      await this.handle.db
        .update(stayLink)
        .set({
          tokenCiphertext: secrets.tokenCiphertext,
          confirmationCiphertext: secrets.confirmationCiphertext,
          dataKeyId: secrets.dataKeyId,
        })
        .where(eq(stayLink.id, link.id));
    }
  }
}
