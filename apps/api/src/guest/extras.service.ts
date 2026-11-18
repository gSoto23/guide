import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { extra, serviceRequest, stay, type Database } from "@guidesk/db";
import { checkRequest, EXTRA_LIMITS, localized, lockState, type ExtraRules } from "@guidesk/domain";
import type {
  GuestExtra,
  GuestExtras,
  GuestServiceRequest,
  GuestServiceRequestBody,
  GuestServiceRequests,
} from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { countRequest } from "../extras/service-requests.service.js";
import { GuestContext, type GuestTarget } from "./guest-context.js";
import { GuestSessions, type GuestDevice } from "./sessions.service.js";

type ExtraRow = typeof extra.$inferSelect;
type RequestRow = typeof serviceRequest.$inferSelect;

function guestExtra(row: ExtraRow, language: "es" | "en"): GuestExtra {
  const name = localized(row.name, language, row.sourceLanguage);
  const description = localized(row.description, name.language, row.sourceLanguage);
  return {
    id: row.id,
    name: name.text,
    description: description.text,
    language: name.language,
    price: row.price,
    currency: row.currency as GuestExtra["currency"],
    leadTimeHours: row.leadTimeHours,
    needsDate: row.needsDate,
    needsTime: row.needsTime,
    dateRange: row.dateRange,
    weekdays: row.weekdays,
    maxPerStay: row.maxPerStay,
    turnover: row.turnover,
  };
}

function guestRequest(row: RequestRow, language: "es" | "en"): GuestServiceRequest {
  return {
    id: row.id,
    extraId: row.extraId,
    name: localized(row.extraName, language, row.sourceLanguage).text,
    price: row.price,
    currency: row.currency as GuestServiceRequest["currency"],
    requestedDate: row.requestedDate,
    requestedTime: row.requestedTime ? row.requestedTime.slice(0, 5) : null,
    quantity: row.quantity,
    status: row.status,
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Extras for guests (feature 008 US2, FR-007 to FR-014, research R3): the public list, and the stay's
 * requests, which need the stay session for that property inside its window (verified when the stay
 * requires the code). The stay always comes from the session; the name and price always come from the
 * catalog (AC-SEC-001, AC-SEC-002).
 */
@Injectable()
export class GuestExtrasService {
  constructor(
    private readonly context: GuestContext,
    private readonly sessions: GuestSessions,
  ) {}

  /** Visible extras of a property, in order (also for the guide's `extras.visible`). */
  async visible(db: Database, target: { workspaceId: string; propertyId: string }) {
    return db
      .select()
      .from(extra)
      .where(
        and(
          eq(extra.workspaceId, target.workspaceId),
          eq(extra.propertyId, target.propertyId),
          eq(extra.visible, true),
        ),
      )
      .orderBy(asc(extra.position), asc(extra.createdAt));
  }

  async list(publicId: string, lang: "es" | "en" | undefined): Promise<GuestExtras> {
    const target = await this.context.byPublicId(publicId);
    const language = lang ?? target.languages[0] ?? "es";
    const rows = await this.visible(this.context.db, target);
    return { extras: rows.map((row) => guestExtra(row, language)) };
  }

  /** Whether this device may request, and why not (FR-008). */
  private allowed(target: GuestTarget, device: GuestDevice | null): GuestServiceRequests["reason"] {
    if (!device) return "no_session";
    const state = lockState(device.context, new Date()).state;
    if (state !== "before" && state !== "inside") return "ended";
    if (target.requireConfirmationCode && !device.verified) return "verify";
    return null;
  }

  async requests(
    publicId: string,
    cookieHeader: string | undefined,
    lang: "es" | "en" | undefined,
  ): Promise<GuestServiceRequests> {
    const target = await this.context.byPublicId(publicId);
    const device = await this.sessions.device(target, cookieHeader);
    const reason = this.allowed(target, device);
    if (!device) return { canRequest: false, reason, requests: [] };
    const rows = await this.context.db
      .select()
      .from(serviceRequest)
      .where(
        and(
          eq(serviceRequest.stayId, device.stayId),
          eq(serviceRequest.propertyId, target.propertyId),
        ),
      )
      .orderBy(desc(serviceRequest.createdAt))
      .limit(50);
    const language = lang ?? target.languages[0] ?? "es";
    return {
      canRequest: reason === null,
      reason,
      requests: rows.map((row) => guestRequest(row, language)),
    };
  }

  private async session(publicId: string, cookieHeader: string | undefined) {
    const target = await this.context.byPublicId(publicId);
    const device = await this.sessions.device(target, cookieHeader);
    const reason = this.allowed(target, device);
    if (reason === "no_session") throw new ApiProblem(401, "no_session");
    if (reason === "ended") throw new ApiProblem(409, "not_requestable");
    if (reason === "verify") throw new ApiProblem(409, "verification_required");
    return { target, device: device! };
  }

  async create(
    body: GuestServiceRequestBody,
    cookieHeader: string | undefined,
    lang: "es" | "en" | undefined,
  ): Promise<GuestServiceRequest> {
    const { target, device } = await this.session(body.publicId, cookieHeader);
    const db = this.context.db;
    const [row] = await db
      .select()
      .from(extra)
      .where(
        and(
          eq(extra.id, body.extraId),
          eq(extra.workspaceId, target.workspaceId),
          eq(extra.propertyId, target.propertyId),
          eq(extra.visible, true),
        ),
      )
      .limit(1);
    if (!row) throw new ApiProblem(404, "not_found");
    const [current] = await db.select().from(stay).where(eq(stay.id, device.stayId)).limit(1);
    if (!current || current.status !== "active") throw new ApiProblem(409, "not_requestable");

    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const mine = await db
      .select({
        extraId: serviceRequest.extraId,
        status: serviceRequest.status,
        quantity: serviceRequest.quantity,
        requestedDate: serviceRequest.requestedDate,
        requestedTime: serviceRequest.requestedTime,
        createdAt: serviceRequest.createdAt,
      })
      .from(serviceRequest)
      .where(eq(serviceRequest.stayId, device.stayId));
    const waiting = mine.filter((request) => request.status === "waiting").length;
    const today = mine.filter((request) => request.createdAt >= dayAgo).length;
    if (waiting >= EXTRA_LIMITS.waitingPerStay || today >= EXTRA_LIMITS.createdPerStayPerDay) {
      throw new ApiProblem(429, "too_many_requests");
    }
    const used = mine
      .filter(
        (request) =>
          request.extraId === row.id &&
          (request.status === "waiting" || request.status === "confirmed"),
      )
      .reduce((sum, request) => sum + request.quantity, 0);
    const others = await db
      .select({ checkInDate: stay.checkInDate, checkoutDate: stay.checkoutDate })
      .from(stay)
      .where(
        and(
          eq(stay.propertyId, target.propertyId),
          eq(stay.status, "active"),
          ne(stay.id, current.id),
          gte(stay.checkoutDate, current.checkInDate),
        ),
      );
    const rules: ExtraRules = {
      leadTimeHours: row.leadTimeHours,
      weekdays: row.weekdays,
      needsDate: row.needsDate,
      needsTime: row.needsTime,
      dateRange: row.dateRange,
      maxPerStay: row.maxPerStay,
      preApproved: row.preApproved,
      turnover: row.turnover,
    };
    const checked = checkRequest(
      rules,
      { date: body.date ?? null, time: body.time ?? null, quantity: body.quantity },
      {
        stay: { checkInDate: current.checkInDate, checkoutDate: current.checkoutDate },
        timeZone: target.timeZone,
        now,
        usedQuantity: used,
        otherStays: others,
      },
    );
    if (!checked.ok) {
      throw new ApiProblem(422, "rule_failed", undefined, { details: { rule: checked.rule } });
    }
    const duplicateSince = new Date(now.getTime() - EXTRA_LIMITS.duplicateSeconds * 1000);
    const duplicate = mine.some(
      (request) =>
        request.extraId === row.id &&
        request.createdAt >= duplicateSince &&
        request.requestedDate === checked.date &&
        (request.requestedTime?.slice(0, 5) ?? null) === checked.time,
    );
    if (duplicate) throw new ApiProblem(409, "duplicate");

    const [stored] = await db
      .insert(serviceRequest)
      .values({
        workspaceId: target.workspaceId,
        propertyId: target.propertyId,
        stayId: current.id,
        extraId: row.id,
        extraName: row.name,
        sourceLanguage: row.sourceLanguage,
        price: row.price,
        currency: row.currency,
        requestedDate: checked.date,
        requestedTime: checked.time,
        quantity: body.quantity,
        note: body.note ?? null,
        status: checked.status,
        expiresAt: checked.expiresAt,
      })
      .returning();
    const timeZone = target.timeZone;
    await countRequest(db, { ...target, timeZone }, "waiting");
    if (checked.status === "confirmed")
      await countRequest(db, { ...target, timeZone }, "confirmed");
    return guestRequest(stored!, lang ?? target.languages[0] ?? "es");
  }

  async cancel(
    requestId: string,
    publicId: string,
    cookieHeader: string | undefined,
    lang: "es" | "en" | undefined,
  ): Promise<GuestServiceRequest> {
    const { target, device } = await this.session(publicId, cookieHeader);
    const [updated] = await this.context.db
      .update(serviceRequest)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(serviceRequest.id, requestId),
          eq(serviceRequest.stayId, device.stayId),
          eq(serviceRequest.propertyId, target.propertyId),
          inArray(serviceRequest.status, ["waiting"]),
        ),
      )
      .returning();
    if (!updated) {
      const [exists] = await this.context.db
        .select({ id: serviceRequest.id })
        .from(serviceRequest)
        .where(and(eq(serviceRequest.id, requestId), eq(serviceRequest.stayId, device.stayId)))
        .limit(1);
      throw exists ? new ApiProblem(409, "not_waiting") : new ApiProblem(404, "not_found");
    }
    await countRequest(this.context.db, { ...target }, "cancelled");
    return guestRequest(updated, lang ?? target.languages[0] ?? "es");
  }
}
