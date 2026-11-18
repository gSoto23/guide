import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { extra, property } from "@guidesk/db";
import { can, type Role } from "@guidesk/domain";
import type { ExtraInput, MemberExtra, MemberExtras } from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";

export interface ExtrasCaller {
  userId: string;
  role: Role;
}

type ExtraRow = typeof extra.$inferSelect;

export function memberExtra(row: ExtraRow): MemberExtra {
  return {
    id: row.id,
    propertyId: row.propertyId,
    sourceLanguage: row.sourceLanguage,
    name: row.name,
    description: row.description,
    price: row.price,
    currency: row.currency as MemberExtra["currency"],
    leadTimeHours: row.leadTimeHours,
    weekdays: row.weekdays,
    needsDate: row.needsDate,
    needsTime: row.needsTime,
    dateRange: row.dateRange,
    maxPerStay: row.maxPerStay,
    preApproved: row.preApproved,
    turnover: row.turnover,
    visible: row.visible,
    position: row.position,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const values = (input: ExtraInput) => ({
  sourceLanguage: input.sourceLanguage,
  name: input.name,
  description: input.description,
  price: input.price,
  currency: input.currency,
  leadTimeHours: input.leadTimeHours,
  weekdays: [...input.weekdays].sort((a, b) => a - b),
  needsDate: input.needsDate,
  needsTime: input.needsTime,
  dateRange: input.dateRange,
  maxPerStay: input.maxPerStay,
  preApproved: input.preApproved,
  turnover: input.turnover,
  visible: input.visible,
});

/**
 * A property's extras (feature 008 US1, FR-001 to FR-005, research R1): members read; owners and
 * admins create, edit with a version, order, copy, and delete. Waiting requests keep what the guest
 * saw when an extra changes or goes away. Changes are logged without values (SEC-16).
 */
@Injectable()
export class ExtrasService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  private async propertyOf(workspaceId: string, propertyId: string): Promise<void> {
    const [row] = await this.tx
      .select({ id: property.id })
      .from(property)
      .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "property", propertyId);
    }
  }

  private async extraOf(workspaceId: string, propertyId: string, extraId: string) {
    const [row] = await this.tx
      .select()
      .from(extra)
      .where(
        and(
          eq(extra.id, extraId),
          eq(extra.propertyId, propertyId),
          eq(extra.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!row)
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "extra", extraId);
    return row;
  }

  private log(
    caller: ExtrasCaller,
    workspaceId: string,
    propertyId: string,
    action: "created" | "updated" | "deleted" | "copied" | "ordered",
    count?: number,
  ) {
    return this.securityLog.record({
      type: "extras.changed",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "property",
      targetId: propertyId,
      metadata: { propertyId, action, ...(count !== undefined ? { count } : {}) },
    });
  }

  async list(caller: ExtrasCaller, workspaceId: string, propertyId: string): Promise<MemberExtras> {
    await this.propertyOf(workspaceId, propertyId);
    const rows = await this.tx
      .select()
      .from(extra)
      .where(and(eq(extra.propertyId, propertyId), eq(extra.workspaceId, workspaceId)))
      .orderBy(asc(extra.position), asc(extra.createdAt));
    return { extras: rows.map(memberExtra), canEdit: can(caller.role, "properties.manage") };
  }

  async create(
    caller: ExtrasCaller,
    workspaceId: string,
    propertyId: string,
    input: ExtraInput,
  ): Promise<MemberExtra> {
    await this.propertyOf(workspaceId, propertyId);
    const [next] = await this.tx
      .select({ position: sql<number>`coalesce(max(${extra.position}) + 1, 0)::int` })
      .from(extra)
      .where(eq(extra.propertyId, propertyId));
    const [row] = await this.tx
      .insert(extra)
      .values({
        workspaceId,
        propertyId,
        ...values(input),
        position: next?.position ?? 0,
        updatedBy: caller.userId,
      })
      .returning();
    await this.log(caller, workspaceId, propertyId, "created");
    return memberExtra(row!);
  }

  async update(
    caller: ExtrasCaller,
    workspaceId: string,
    propertyId: string,
    extraId: string,
    version: number,
    input: ExtraInput,
  ): Promise<MemberExtra> {
    await this.extraOf(workspaceId, propertyId, extraId);
    const [row] = await this.tx
      .update(extra)
      .set({
        ...values(input),
        version: sql`${extra.version} + 1`,
        updatedAt: sql`now()`,
        updatedBy: caller.userId,
      })
      .where(and(eq(extra.id, extraId), eq(extra.version, version)))
      .returning();
    if (!row) throw new ApiProblem(409, "extra_changed");
    await this.log(caller, workspaceId, propertyId, "updated");
    return memberExtra(row);
  }

  async remove(
    caller: ExtrasCaller,
    workspaceId: string,
    propertyId: string,
    extraId: string,
  ): Promise<void> {
    await this.extraOf(workspaceId, propertyId, extraId);
    await this.tx.delete(extra).where(eq(extra.id, extraId));
    await this.log(caller, workspaceId, propertyId, "deleted");
  }

  async order(
    caller: ExtrasCaller,
    workspaceId: string,
    propertyId: string,
    ids: string[],
  ): Promise<MemberExtras> {
    await this.propertyOf(workspaceId, propertyId);
    const rows = await this.tx
      .select({ id: extra.id })
      .from(extra)
      .where(and(eq(extra.propertyId, propertyId), eq(extra.workspaceId, workspaceId)));
    const known = new Set(rows.map((row) => row.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
      throw new ApiProblem(422, "validation_failed");
    }
    for (const [position, id] of ids.entries()) {
      await this.tx.update(extra).set({ position }).where(eq(extra.id, id));
    }
    await this.log(caller, workspaceId, propertyId, "ordered");
    return this.list(caller, workspaceId, propertyId);
  }

  async copy(
    caller: ExtrasCaller,
    workspaceId: string,
    propertyId: string,
    extraId: string,
    propertyIds: string[],
  ): Promise<{ copied: number }> {
    const source = await this.extraOf(workspaceId, propertyId, extraId);
    const targets = [...new Set(propertyIds)].filter((id) => id !== propertyId);
    if (targets.length === 0) return { copied: 0 };
    const found = await this.tx
      .select({ id: property.id })
      .from(property)
      .where(and(eq(property.workspaceId, workspaceId), inArray(property.id, targets)));
    if (found.length !== targets.length) {
      const missing = targets.find((id) => !found.some((row) => row.id === id))!;
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "property", missing);
    }
    for (const target of targets) {
      const [next] = await this.tx
        .select({ position: sql<number>`coalesce(max(${extra.position}) + 1, 0)::int` })
        .from(extra)
        .where(eq(extra.propertyId, target));
      await this.tx.insert(extra).values({
        workspaceId,
        propertyId: target,
        ...values(memberExtra(source)),
        position: next?.position ?? 0,
        updatedBy: caller.userId,
      });
      await this.log(caller, workspaceId, target, "copied");
    }
    return { copied: targets.length };
  }
}
