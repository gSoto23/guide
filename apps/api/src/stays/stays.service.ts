import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type {
  CreateStayBody,
  ListStaysQuery,
  Stay,
  StayGuestBody,
  StayList,
  UpdateStayBody,
} from "@guidesk/contracts";
import { calendarFeedPublic, stay, type DbHandle } from "@guidesk/db";
import { flagOverlaps, todayIn, type Role } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";
import { PropertiesService } from "../properties/properties.service.js";
import { toTimeOfDay } from "../properties/property-mapper.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";

interface Caller {
  userId: string;
  role: Role;
}

type StayRow = typeof stay.$inferSelect;

function toStay(row: StayRow, overlaps: boolean, possiblyOutdated: boolean): Stay {
  return {
    id: row.id,
    propertyId: row.propertyId,
    source: row.source,
    channel: row.channel,
    checkInDate: row.checkInDate,
    checkoutDate: row.checkoutDate,
    checkInTime: toTimeOfDay(row.checkInTime),
    checkoutTime: toTimeOfDay(row.checkoutTime),
    status: row.status,
    mayBeBlock: row.mayBeBlock,
    overlaps,
    possiblyOutdated,
    guestCount: row.guestCount,
    guestName: row.guestName,
    guestNameRemoved: row.guestNameRemovedAt !== null,
    bookingReference: row.bookingReference,
    guestDetailsSource: row.guestDetailsSource ?? null,
  };
}

/**
 * Stays (US3, T076): upcoming stays of a property from feeds, the PMS, and by hand. Feed and PMS
 * stays are read-only here except hiding a possible block and removing a guest name (FR-053).
 */
@Injectable()
export class StaysService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly properties: PropertiesService,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  private async loadStay(caller: Caller, workspaceId: string, stayId: string): Promise<StayRow> {
    const [row] = await this.requestDb
      .current()
      .select()
      .from(stay)
      .where(and(eq(stay.id, stayId), eq(stay.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw await this.crossTenant.notFound(caller.userId, workspaceId, "stay", stayId);
    return row;
  }

  /** Active, non-duplicate stays of the property from `from` on, for the overlap flags. */
  private async visibleStays(propertyId: string, from: string): Promise<StayRow[]> {
    return this.requestDb
      .current()
      .select()
      .from(stay)
      .where(
        and(
          eq(stay.propertyId, propertyId),
          eq(stay.status, "active"),
          isNull(stay.duplicateOfId),
          gte(stay.checkoutDate, from),
        ),
      );
  }

  /** Feeds and PMS connections that are failing, so their stays may be out of date (FR-024). */
  private async outdatedSources(
    rows: StayRow[],
  ): Promise<{ feeds: Set<string>; connections: Set<string> }> {
    const feedIds = [
      ...new Set(rows.map((row) => row.calendarFeedId).filter((id): id is string => !!id)),
    ];
    const connectionIds = [
      ...new Set(rows.map((row) => row.pmsConnectionId).filter((id): id is string => !!id)),
    ];
    const feeds = new Set<string>();
    if (feedIds.length > 0) {
      const failing = await this.requestDb
        .current()
        .select({ id: calendarFeedPublic.id })
        .from(calendarFeedPublic)
        .where(
          and(inArray(calendarFeedPublic.id, feedIds), eq(calendarFeedPublic.status, "failing")),
        );
      for (const feed of failing) feeds.add(feed.id);
    }
    const connections = new Set<string>();
    if (connectionIds.length > 0) {
      // Agents cannot read PMS connections; only their failing state is used here (system context).
      const failing = await this.handle.db.execute<{ id: string }>(
        sql`SELECT id FROM pms_connection WHERE id IN (${sql.join(
          connectionIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) AND status = 'failing'`,
      );
      for (const row of failing.rows) connections.add(row.id);
    }
    return { feeds, connections };
  }

  async list(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    query: ListStaysQuery,
  ): Promise<StayList> {
    const property = await this.properties.load(caller, workspaceId, propertyId);
    const from = query.from ?? todayIn(property.timeZone ?? "UTC");
    const conditions: SQL[] = [
      eq(stay.propertyId, propertyId),
      gte(stay.checkoutDate, from),
      isNull(stay.duplicateOfId),
    ];
    if (query.status !== "all") conditions.push(eq(stay.status, query.status));
    const rows = await this.requestDb
      .current()
      .select()
      .from(stay)
      .where(and(...conditions))
      .orderBy(stay.checkInDate, stay.checkoutDate);
    const overlapping = flagOverlaps(await this.visibleStays(propertyId, from));
    const outdated = await this.outdatedSources(rows);
    return {
      items: rows.map((row) =>
        toStay(
          row,
          overlapping.has(row.id),
          (row.calendarFeedId !== null && outdated.feeds.has(row.calendarFeedId)) ||
            (row.pmsConnectionId !== null && outdated.connections.has(row.pmsConnectionId)),
        ),
      ),
    };
  }

  private async withOverlap(row: StayRow): Promise<Stay> {
    const overlapping = flagOverlaps(await this.visibleStays(row.propertyId, row.checkInDate));
    return toStay(row, overlapping.has(row.id), false);
  }

  private async log(
    type:
      | "stay.added_manually"
      | "stay.changed_manually"
      | "stay.cancelled_manually"
      | "stay.guest_name_removed",
    caller: Caller,
    workspaceId: string,
    row: StayRow,
  ): Promise<void> {
    await this.securityLog.record({
      type,
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "stay",
      targetId: row.id,
      metadata: { stayId: row.id, checkInDate: row.checkInDate, checkoutDate: row.checkoutDate },
    });
  }

  /** A stay added by hand (FR-052): "Direct" by default, the property's times unless given. */
  async create(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    body: CreateStayBody,
  ): Promise<Stay> {
    const property = await this.properties.load(caller, workspaceId, propertyId);
    if (property.status !== "active") throw new ApiProblem(404, "not_found");
    const [row] = await this.requestDb
      .current()
      .insert(stay)
      .values({
        workspaceId,
        propertyId,
        source: "manual",
        checkInDate: body.checkInDate,
        checkoutDate: body.checkoutDate,
        checkInTime: body.checkInTime ?? null,
        checkoutTime: body.checkoutTime ?? null,
        channel: body.channel ?? "Direct",
        guestCount: body.guestCount ?? null,
        guestName: body.guestName ?? null,
        createdBy: caller.userId,
      })
      .returning();
    await this.log("stay.added_manually", caller, workspaceId, row!);
    return this.withOverlap(row!);
  }

  async update(
    caller: Caller,
    workspaceId: string,
    stayId: string,
    body: UpdateStayBody,
  ): Promise<Stay> {
    const current = await this.loadStay(caller, workspaceId, stayId);
    const tx = this.requestDb.current();
    if (current.source !== "manual") {
      // Feed and PMS stays: only hiding an active stay that may be a block (FR-022, FR-053).
      const onlyHide = Object.keys(body).length === 1 && body.status === "hidden";
      if (!onlyHide || !current.mayBeBlock || current.status !== "active") {
        throw new ApiProblem(
          409,
          "conflict",
          "Stays from a calendar or a PMS can only be hidden when they may be a block.",
        );
      }
      const [row] = await tx
        .update(stay)
        .set({ status: "hidden" })
        .where(eq(stay.id, stayId))
        .returning();
      return this.withOverlap(row!);
    }
    if (current.status === "cancelled")
      throw new ApiProblem(409, "conflict", "This stay is cancelled.");
    const checkInDate = body.checkInDate ?? current.checkInDate;
    const checkoutDate = body.checkoutDate ?? current.checkoutDate;
    if (checkoutDate <= checkInDate) {
      throw new ApiProblem(422, "validation_failed", undefined, {
        fields: { checkoutDate: ["Checkout must be after check-in"] },
      });
    }
    const { status, guestName, ...fields } = body;
    if (guestName !== undefined && current.guestNameRemovedAt !== null && guestName !== null) {
      throw new ApiProblem(409, "conflict", "This guest's name was removed on request.");
    }
    const [row] = await tx
      .update(stay)
      .set({
        ...fields,
        ...(guestName !== undefined ? { guestName } : {}),
        ...(status ? { status } : {}),
      })
      .where(eq(stay.id, stayId))
      .returning();
    await this.log("stay.changed_manually", caller, workspaceId, row!);
    return this.withOverlap(row!);
  }

  async cancel(caller: Caller, workspaceId: string, stayId: string): Promise<Stay> {
    const current = await this.loadStay(caller, workspaceId, stayId);
    if (current.source !== "manual") {
      throw new ApiProblem(409, "conflict", "Only stays added by hand can be cancelled here.");
    }
    const [row] = await this.requestDb
      .current()
      .update(stay)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(and(eq(stay.id, stayId), ne(stay.status, "cancelled")))
      .returning();
    const result = row ?? current;
    if (row) await this.log("stay.cancelled_manually", caller, workspaceId, row);
    return toStay(result, false, false);
  }

  /** Removes a guest name on request; later refreshes never restore it (FR-053). */
  /**
   * The guest's name and number of guests typed by an owner or admin on any stay (feature 018
   * FR-015, FR-016): marked as the host's, so feed and PMS refreshes keep them. A name removed on
   * request (FR-053) cannot be set again. The log records which fields changed, never the name.
   */
  async setGuestDetails(
    caller: Caller,
    workspaceId: string,
    stayId: string,
    body: StayGuestBody,
  ): Promise<Stay> {
    const current = await this.loadStay(caller, workspaceId, stayId);
    const guestName = body.guestName === undefined ? current.guestName : body.guestName;
    const guestCount = body.guestCount === undefined ? current.guestCount : body.guestCount;
    if (body.guestName != null && current.guestNameRemovedAt !== null) {
      throw new ApiProblem(409, "conflict", "This guest's name was removed on request.");
    }
    const nameChanged = guestName !== current.guestName;
    const countChanged = guestCount !== current.guestCount;
    if (!nameChanged && !countChanged) return this.withOverlap(current);
    const [row] = await this.requestDb
      .current()
      .update(stay)
      .set({
        guestName,
        guestCount,
        guestDetailsSource: "host",
        guestDetailsBy: caller.userId,
        guestDetailsAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(stay.id, stayId))
      .returning();
    await this.securityLog.record({
      type: "stay.guest_details_changed",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "stay",
      targetId: stayId,
      metadata: { stayId, name: nameChanged, count: countChanged },
    });
    return this.withOverlap(row!);
  }

  async removeGuestName(caller: Caller, workspaceId: string, stayId: string): Promise<Stay> {
    const current = await this.loadStay(caller, workspaceId, stayId);
    const [row] = await this.requestDb
      .current()
      .update(stay)
      .set({ guestName: null, guestNameRemovedAt: current.guestNameRemovedAt ?? new Date() })
      .where(eq(stay.id, stayId))
      .returning();
    await this.log("stay.guest_name_removed", caller, workspaceId, row!);
    return toStay(row!, false, false);
  }
}
