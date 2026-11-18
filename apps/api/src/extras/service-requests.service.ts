import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  property,
  serviceRequest,
  serviceRequestDaily,
  stay,
  type Database,
  type Transaction,
} from "@guidesk/db";
import { localized, todayIn, type ServiceRequestStatus } from "@guidesk/domain";
import type {
  MemberServiceRequest,
  ServiceRequestAnswerBody,
  ServiceRequestPage,
  ServiceRequestsQuery,
} from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";

const PAGE = 50;
const CLOSED: ServiceRequestStatus[] = ["declined", "cancelled", "host_cancelled", "expired"];

/** Adds one to the day's count for a status (FR-026); counts only, no personal data. */
export async function countRequest(
  db: Database | Transaction,
  target: { workspaceId: string; propertyId: string; timeZone: string | null },
  status: ServiceRequestStatus,
): Promise<void> {
  await db
    .insert(serviceRequestDaily)
    .values({
      workspaceId: target.workspaceId,
      propertyId: target.propertyId,
      day: todayIn(target.timeZone ?? "UTC"),
      status,
      count: 1,
    })
    .onConflictDoUpdate({
      target: [serviceRequestDaily.propertyId, serviceRequestDaily.day, serviceRequestDaily.status],
      set: { count: sql`${serviceRequestDaily.count} + 1` },
    });
}

export interface RequestsCaller {
  userId: string;
  language: "es" | "en";
}

/**
 * Add-on requests for members (feature 008 US3, FR-016, FR-017, research R4): waiting first, the
 * soonest requested moment first; confirm, decline, and cancel only from the expected status, so the
 * first answer wins. Every answer is logged with IDs and the status only.
 */
@Injectable()
export class ServiceRequestsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  async list(
    caller: RequestsCaller,
    workspaceId: string,
    query: ServiceRequestsQuery,
  ): Promise<ServiceRequestPage> {
    const offset = Number(query.before ?? 0);
    const status = query.status ?? "all";
    const statuses: ServiceRequestStatus[] =
      status === "waiting"
        ? ["waiting"]
        : status === "confirmed"
          ? ["confirmed"]
          : status === "closed"
            ? CLOSED
            : ["waiting", "confirmed", ...CLOSED];
    const answerer = sql`(SELECT coalesce(nullif(u.name, ''), u.email) FROM "user" u WHERE u.id = ${serviceRequest.answeredBy})`;
    const rows = await this.tx
      .select({
        request: serviceRequest,
        propertyName: property.name,
        checkInDate: stay.checkInDate,
        checkoutDate: stay.checkoutDate,
        guestName: stay.guestName,
        answeredByName: sql<string | null>`${answerer}`,
      })
      .from(serviceRequest)
      .innerJoin(property, eq(property.id, serviceRequest.propertyId))
      .innerJoin(stay, eq(stay.id, serviceRequest.stayId))
      .where(
        and(
          eq(serviceRequest.workspaceId, workspaceId),
          inArray(serviceRequest.status, statuses),
          ...(query.propertyId ? [eq(serviceRequest.propertyId, query.propertyId)] : []),
        ),
      )
      .orderBy(
        sql`(${serviceRequest.status} = 'waiting') DESC`,
        asc(sql`coalesce(${serviceRequest.requestedDate}, ${stay.checkInDate})`),
        asc(serviceRequest.requestedTime),
        desc(serviceRequest.createdAt),
      )
      .limit(PAGE + 1)
      .offset(offset);
    const [waiting] = await this.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(serviceRequest)
      .where(
        and(eq(serviceRequest.workspaceId, workspaceId), eq(serviceRequest.status, "waiting")),
      );
    return {
      items: rows.slice(0, PAGE).map((row) => this.item(row, caller.language)),
      next: rows.length > PAGE ? String(offset + PAGE) : null,
      waiting: waiting?.n ?? 0,
    };
  }

  private item(
    row: {
      request: typeof serviceRequest.$inferSelect;
      propertyName: string;
      checkInDate: string;
      checkoutDate: string;
      guestName: string | null;
      answeredByName: string | null;
    },
    language: "es" | "en",
  ): MemberServiceRequest {
    const r = row.request;
    return {
      id: r.id,
      extraId: r.extraId,
      name: localized(r.extraName, language, r.sourceLanguage).text,
      price: r.price,
      currency: r.currency as MemberServiceRequest["currency"],
      requestedDate: r.requestedDate,
      requestedTime: r.requestedTime ? r.requestedTime.slice(0, 5) : null,
      quantity: r.quantity,
      status: r.status,
      reasonCode: r.reasonCode,
      reasonText: r.reasonText,
      createdAt: r.createdAt.toISOString(),
      propertyId: r.propertyId,
      propertyName: row.propertyName,
      stay: {
        checkInDate: row.checkInDate,
        checkoutDate: row.checkoutDate,
        guestName: row.guestName,
      },
      note: r.note,
      answeredBy: row.answeredByName,
      answeredAt: r.answeredAt?.toISOString() ?? null,
      expiresAt: r.expiresAt.toISOString(),
    };
  }

  private async answer(
    caller: RequestsCaller,
    workspaceId: string,
    requestId: string,
    from: ServiceRequestStatus,
    to: ServiceRequestStatus,
    reason: ServiceRequestAnswerBody | null,
  ): Promise<MemberServiceRequest> {
    const [current] = await this.tx
      .select({
        id: serviceRequest.id,
        status: serviceRequest.status,
        propertyId: serviceRequest.propertyId,
        expiresAt: serviceRequest.expiresAt,
        timeZone: property.timeZone,
      })
      .from(serviceRequest)
      .innerJoin(property, eq(property.id, serviceRequest.propertyId))
      .where(and(eq(serviceRequest.id, requestId), eq(serviceRequest.workspaceId, workspaceId)))
      .limit(1);
    if (!current) {
      throw await this.crossTenant.notFoundInRequest(
        this.tx,
        workspaceId,
        "service_request",
        requestId,
      );
    }
    const expired = from === "waiting" && current.expiresAt.getTime() <= Date.now();
    const [updated] = expired
      ? []
      : await this.tx
          .update(serviceRequest)
          .set({
            status: to,
            reasonCode: reason?.reasonCode ?? null,
            reasonText: reason?.reasonText ?? null,
            answeredBy: caller.userId,
            answeredAt: sql`now()`,
          })
          .where(and(eq(serviceRequest.id, requestId), eq(serviceRequest.status, from)))
          .returning({ id: serviceRequest.id });
    if (!updated) throw new ApiProblem(409, from === "waiting" ? "not_waiting" : "not_confirmed");
    await countRequest(
      this.tx,
      { workspaceId, propertyId: current.propertyId, timeZone: current.timeZone },
      to,
    );
    await this.securityLog.record({
      type: "service_request.answered",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "service_request",
      targetId: requestId,
      metadata: { propertyId: current.propertyId, requestId, status: to },
    });
    const page = await this.tx
      .select({
        request: serviceRequest,
        propertyName: property.name,
        checkInDate: stay.checkInDate,
        checkoutDate: stay.checkoutDate,
        guestName: stay.guestName,
        answeredByName: sql<
          string | null
        >`(SELECT coalesce(nullif(u.name, ''), u.email) FROM "user" u WHERE u.id = ${serviceRequest.answeredBy})`,
      })
      .from(serviceRequest)
      .innerJoin(property, eq(property.id, serviceRequest.propertyId))
      .innerJoin(stay, eq(stay.id, serviceRequest.stayId))
      .where(eq(serviceRequest.id, requestId))
      .limit(1);
    return this.item(page[0]!, caller.language);
  }

  confirm(caller: RequestsCaller, workspaceId: string, requestId: string) {
    return this.answer(caller, workspaceId, requestId, "waiting", "confirmed", null);
  }

  decline(
    caller: RequestsCaller,
    workspaceId: string,
    requestId: string,
    body: ServiceRequestAnswerBody,
  ) {
    return this.answer(caller, workspaceId, requestId, "waiting", "declined", body);
  }

  cancel(
    caller: RequestsCaller,
    workspaceId: string,
    requestId: string,
    body: ServiceRequestAnswerBody,
  ) {
    return this.answer(caller, workspaceId, requestId, "confirmed", "host_cancelled", body);
  }
}
