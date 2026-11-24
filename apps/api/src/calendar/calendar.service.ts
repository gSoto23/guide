import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import {
  conversation,
  guideSession,
  property,
  securityEvent,
  stay,
  stayLink,
  user,
  type DbHandle,
} from "@guidesk/db";
import {
  CALENDAR_MAX_DAYS,
  type CalendarProperty,
  type CalendarQuery,
  type CalendarResponse,
  type CalendarStay,
  type ShareStay,
  type StayOverview,
  type StayTotal,
} from "@guidesk/contracts";
import { STAY_LINK_DEVICE_LIMIT, type Role } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";
import { ServiceRequestsService } from "../extras/service-requests.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";

interface Caller {
  userId: string;
  role: Role;
  language: "es" | "en";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const hhmm = (value: string | null): string | null => (value ? value.slice(0, 5) : null);

/**
 * The stay calendar and the stay view (feature 018 US1, US2, research R1, R2). Every read runs in
 * the member's RLS context, except the stay link state of one stay, which agents cannot read
 * directly (stay links are owners' and admins'): it is computed with system privileges and returns
 * counts and dates only, never a token or a code.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly requests: ServiceRequestsService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  async calendar(
    caller: Caller,
    workspaceId: string,
    query: CalendarQuery,
  ): Promise<CalendarResponse> {
    const from = new Date(`${query.from}T00:00:00Z`).getTime();
    const to = new Date(`${query.to}T00:00:00Z`).getTime();
    if (!(to > from) || (to - from) / DAY_MS > CALENDAR_MAX_DAYS) {
      throw new ApiProblem(
        422,
        "validation_failed",
        `The range must be 1 to ${CALENDAR_MAX_DAYS} days.`,
      );
    }
    const properties = await this.tx
      .select({ id: property.id, name: property.name, timeZone: property.timeZone })
      .from(property)
      .where(
        and(
          eq(property.workspaceId, workspaceId),
          eq(property.status, "active"),
          ...(query.propertyId ? [eq(property.id, query.propertyId)] : []),
        ),
      )
      .orderBy(asc(property.name));
    if (properties.length === 0) return { properties: [], stays: [] };
    const rows = await this.stayRows(workspaceId, {
      propertyIds: properties.map((row) => row.id),
      from: query.from,
      to: query.to,
      channel: query.channel,
      cancelled: query.cancelled === "true",
    });
    return { properties, stays: rows };
  }

  private async stayRows(
    workspaceId: string,
    filter: {
      propertyIds?: string[];
      stayId?: string;
      from?: string;
      to?: string;
      channel?: string;
      cancelled?: boolean;
    },
  ): Promise<(CalendarStay & { raw: typeof stay.$inferSelect })[]> {
    const marks = {
      openEscalation: sql<boolean>`EXISTS (SELECT 1 FROM conversation c WHERE c.stay_id = ${stay.id} AND c.status = 'needs_host')`,
      waitingRequests: sql<number>`(SELECT count(*)::int FROM service_request r WHERE r.stay_id = ${stay.id} AND r.status = 'waiting')`,
      confirmedExtras: sql<number>`(SELECT count(*)::int FROM service_request r WHERE r.stay_id = ${stay.id} AND r.status = 'confirmed')`,
    };
    const rows = await this.tx
      .select({
        raw: stay,
        propertyCheckIn: property.checkInTime,
        propertyCheckout: property.checkoutTime,
        ...marks,
      })
      .from(stay)
      .innerJoin(property, eq(property.id, stay.propertyId))
      .where(
        and(
          eq(stay.workspaceId, workspaceId),
          isNull(stay.duplicateOfId),
          ne(stay.status, "hidden"),
          ...(filter.stayId ? [eq(stay.id, filter.stayId)] : []),
          ...(filter.propertyIds ? [inArray(stay.propertyId, filter.propertyIds)] : []),
          ...(filter.cancelled === false || filter.cancelled === undefined
            ? filter.stayId
              ? []
              : [eq(stay.status, "active")]
            : []),
          ...(filter.channel ? [eq(stay.channel, filter.channel)] : []),
          // Overlaps the range [from, to): checks in before `to` and checks out after `from`.
          ...(filter.to ? [lt(stay.checkInDate, filter.to)] : []),
          ...(filter.from ? [gt(stay.checkoutDate, filter.from)] : []),
        ),
      )
      .orderBy(asc(stay.checkInDate), asc(stay.id));
    return rows.map((row) => ({
      id: row.raw.id,
      propertyId: row.raw.propertyId,
      checkInDate: row.raw.checkInDate,
      checkoutDate: row.raw.checkoutDate,
      checkInTime: hhmm(row.raw.checkInTime ?? row.propertyCheckIn),
      checkoutTime: hhmm(row.raw.checkoutTime ?? row.propertyCheckout),
      source: row.raw.source,
      channel: row.raw.channel,
      status: row.raw.status === "cancelled" ? "cancelled" : "active",
      mayBeBlock: row.raw.mayBeBlock,
      overlaps: row.raw.overlaps,
      guestName: row.raw.guestName,
      guestCount: row.raw.guestCount,
      bookingReference: row.raw.bookingReference,
      marks: {
        linkOpened: row.raw.guideOpenedAt !== null,
        openEscalation: Boolean(row.openEscalation),
        waitingRequests: Number(row.waitingRequests),
        confirmedExtras: Number(row.confirmedExtras),
      },
      raw: row.raw,
    }));
  }

  async overview(caller: Caller, workspaceId: string, stayId: string): Promise<StayOverview> {
    const [row] = await this.stayRows(workspaceId, { stayId });
    if (!row) throw await this.crossTenant.notFound(caller.userId, workspaceId, "stay", stayId);
    const { raw, ...calendarStay } = row;
    const [prop] = await this.tx
      .select({ id: property.id, name: property.name, timeZone: property.timeZone })
      .from(property)
      .where(eq(property.id, raw.propertyId));
    const [setBy] = raw.guestDetailsBy
      ? await this.tx
          .select({ name: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})` })
          .from(user)
          .where(eq(user.id, raw.guestDetailsBy))
      : [];
    const conversations = await this.tx
      .select({
        id: conversation.id,
        status: conversation.status,
        reason: conversation.needsHostReason,
        lastMessageAt: conversation.lastMessageAt,
      })
      .from(conversation)
      .where(and(eq(conversation.workspaceId, workspaceId), eq(conversation.stayId, stayId)))
      .orderBy(desc(conversation.lastMessageAt));
    const page = await this.requests.list(
      { userId: caller.userId, language: caller.language },
      workspaceId,
      { stayId, status: "all" },
    );
    return {
      stay: {
        ...calendarStay,
        guestNameRemoved: raw.guestNameRemovedAt !== null,
        guestDetails: {
          source: raw.guestDetailsSource ?? null,
          setAt: raw.guestDetailsAt ? raw.guestDetailsAt.toISOString() : null,
          setBy: setBy?.name ?? null,
        },
      },
      property: prop as CalendarProperty,
      link: await this.linkState(workspaceId, raw),
      conversations: conversations.map((item) => ({
        id: item.id,
        status: item.status,
        reason: item.reason ?? null,
        lastMessageAt: item.lastMessageAt ? new Date(item.lastMessageAt).toISOString() : null,
      })),
      requests: page.items,
      totals: totalsOf(page.items),
      canManage: caller.role === "owner" || caller.role === "admin",
    };
  }

  /** The stay link state of one stay (FR-009): counts and dates only, read with system privileges. */
  private async linkState(
    workspaceId: string,
    raw: typeof stay.$inferSelect,
  ): Promise<ShareStay["link"]> {
    const db = this.handle.db;
    const links = await db
      .select({
        id: stayLink.id,
        status: stayLink.status,
        lockedUntil: stayLink.lockedUntil,
        lastCopiedAt: stayLink.lastCopiedAt,
      })
      .from(stayLink)
      .where(and(eq(stayLink.workspaceId, workspaceId), eq(stayLink.stayId, raw.id)))
      .orderBy(desc(stayLink.createdAt));
    const link = links.find((item) => item.status === "active") ?? links[0];
    const [used] = link
      ? await db
          .select({
            devices: sql<number>`count(*)::int`,
            firstOpenedAt: sql<Date | null>`min(${guideSession.createdAt})`,
          })
          .from(guideSession)
          .where(eq(guideSession.stayLinkId, link.id))
      : [];
    const [shown] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(securityEvent)
      .where(
        and(
          eq(securityEvent.workspaceId, workspaceId),
          eq(securityEvent.type, "restricted_value.guest_revealed"),
          sql`${securityEvent.metadata}->>'stayId' = ${raw.id}`,
        ),
      );
    const devices = Number(used?.devices ?? 0);
    let status: ShareStay["link"]["status"] = "not_created";
    if (link) {
      if (raw.status !== "active") status = "ended";
      else if (link.status === "revoked") status = "revoked";
      else if (link.status === "active") {
        status = devices >= STAY_LINK_DEVICE_LIMIT ? "device_limit" : "active";
      } else status = "ended";
    } else if (raw.status !== "active") status = "ended";
    return {
      status,
      devices,
      firstOpenedAt: used?.firstOpenedAt ? new Date(used.firstOpenedAt).toISOString() : null,
      valuesShown: Number(shown?.count ?? 0),
      lockedUntil: link?.lockedUntil ? link.lockedUntil.toISOString() : null,
      lastCopiedAt: link?.lastCopiedAt ? link.lastCopiedAt.toISOString() : null,
    };
  }
}

/** Totals per currency (FR-012): confirmed add-ons, and what was paid through checkout. */
export function totalsOf(
  items: {
    status: string;
    price: number;
    quantity: number;
    currency: string;
    payment: { state: string; amountMinor: number; refundedMinor: number; currency: string } | null;
  }[],
): StayTotal[] {
  const byCurrency = new Map<string, StayTotal>();
  const entry = (currency: string) => {
    const current = byCurrency.get(currency) ?? { currency, confirmed: 0, paid: 0 };
    byCurrency.set(currency, current);
    return current;
  };
  for (const item of items) {
    if (item.status === "confirmed") {
      entry(item.currency).confirmed += Math.round(item.price * item.quantity * 100) / 100;
    }
    const payment = item.payment;
    if (payment && ["paid", "partially_refunded", "disputed"].includes(payment.state)) {
      entry(payment.currency).paid += (payment.amountMinor - payment.refundedMinor) / 100;
    }
  }
  return [...byCurrency.values()].map((total) => ({
    currency: total.currency,
    confirmed: Math.round(total.confirmed * 100) / 100,
    paid: Math.round(total.paid * 100) / 100,
  }));
}
