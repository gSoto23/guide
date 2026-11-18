import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNotNull } from "drizzle-orm";
import { guide, guideLink, property, workspace, type DbHandle } from "@guidesk/db";
import { isPropertyLinkId, type GuideLanguage } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";

/**
 * The guide a guest request is about (feature 004 research R12). Guests have no member, so the
 * request runs in the system context, and every query is scoped by the workspace and property
 * resolved here from a property link: never from anything else the client sends.
 */
export interface GuestTarget {
  workspaceId: string;
  propertyId: string;
  guideId: string;
  publicId: string;
  propertyName: string;
  timeZone: string;
  country: string | null;
  checkInTime: string | null;
  checkoutTime: string | null;
  languages: GuideLanguage[];
  requireConfirmationCode: boolean;
}

/** One body for every unavailable case, so responses never tell them apart (FR-011, FR-054). */
export function unavailable(): ApiProblem {
  return new ApiProblem(404, "unavailable");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class GuestContext {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly requestDb: RequestDb,
  ) {}

  /** The published guide behind a property link, or `unavailable` for every other case. */
  async byPublicId(publicId: string): Promise<GuestTarget> {
    if (!isPropertyLinkId(publicId)) throw unavailable();
    const [row] = await this.handle.db
      .select({
        workspaceId: guideLink.workspaceId,
        propertyId: guideLink.propertyId,
        guideId: guide.id,
        propertyName: property.name,
        timeZone: property.timeZone,
        country: property.country,
        checkInTime: property.checkInTime,
        checkoutTime: property.checkoutTime,
        languages: property.guideLanguages,
        requireConfirmationCode: guide.requireConfirmationCode,
      })
      .from(guideLink)
      .innerJoin(
        property,
        and(eq(property.id, guideLink.propertyId), eq(property.workspaceId, guideLink.workspaceId)),
      )
      .innerJoin(workspace, eq(workspace.id, guideLink.workspaceId))
      .innerJoin(guide, eq(guide.propertyId, guideLink.propertyId))
      .where(
        and(
          eq(guideLink.publicId, publicId),
          eq(guideLink.status, "active"),
          eq(property.status, "active"),
          eq(workspace.status, "active"),
          eq(guide.status, "published"),
          isNotNull(guide.publishedVersionId),
        ),
      )
      .limit(1);
    if (!row) throw unavailable();
    return { ...row, publicId, timeZone: row.timeZone ?? "UTC" };
  }

  /** The active property link of a property (for stay sessions that only know the property). */
  async publicIdOf(workspaceId: string, propertyId: string): Promise<string | null> {
    const [row] = await this.handle.db
      .select({ publicId: guideLink.publicId })
      .from(guideLink)
      .where(
        and(
          eq(guideLink.workspaceId, workspaceId),
          eq(guideLink.propertyId, propertyId),
          eq(guideLink.status, "active"),
        ),
      )
      .limit(1);
    return row?.publicId ?? null;
  }

  /** Runs `fn` with a system-context transaction as the request transaction (research R12). */
  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.handle.db.transaction((tx) => this.requestDb.run(tx, fn));
  }

  get db(): DbHandle["db"] {
    return this.handle.db;
  }
}

/** Reads one cookie from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}
