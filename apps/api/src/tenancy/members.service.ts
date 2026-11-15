import { Injectable } from "@nestjs/common";
import { and, asc, eq } from "drizzle-orm";
import { canManageMember, type Role } from "@guidesk/domain";
import { membership, user, workspace, type Transaction } from "@guidesk/db";
import { renderMemberRemoved, renderRoleChanged } from "@guidesk/emails";
import type { Member, MemberList } from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "./cross-tenant.js";
import { revokeInvitationsSentBy } from "./invitation-cleanup.js";
import { MemberNotices } from "./member-notices.js";
import { TenancyService } from "./tenancy.service.js";

const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, agent: 2 };

interface Actor {
  id: string;
  role: Role;
}

/**
 * Member list, role changes, and removal (FR-016, FR-025, AC-SEC-003, T092). Runs in the
 * request's RLS transaction: the database also refuses any change to the owner's row.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
    private readonly notices: MemberNotices,
    private readonly tenancy: TenancyService,
  ) {}

  async list(workspaceId: string): Promise<MemberList> {
    const rows = await this.requestDb
      .current()
      .select({
        membershipId: membership.id,
        userId: membership.userId,
        role: membership.role,
        joinedAt: membership.createdAt,
        name: user.name,
        email: user.email,
      })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(eq(membership.workspaceId, workspaceId))
      .orderBy(asc(membership.createdAt));
    return {
      members: rows
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
        .map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() })),
    };
  }

  async changeRole(
    actor: Actor,
    workspaceId: string,
    membershipId: string,
    role: "admin" | "agent",
  ): Promise<Member> {
    const tx = this.requestDb.current();
    const target = await this.find(tx, actor.id, workspaceId, membershipId);
    await this.authorize(actor, workspaceId, target, "member.role_changed");
    if (target.role !== role) {
      if (role === "agent") await revokeInvitationsSentBy(tx, workspaceId, target.userId);
      const changed = await tx
        .update(membership)
        .set({ role })
        .where(and(eq(membership.id, target.membershipId), eq(membership.workspaceId, workspaceId)))
        .returning({ id: membership.id });
      if (changed.length === 0) throw new ApiProblem(404, "not_found");
      await this.securityLog.record({
        type: "member.role_changed",
        outcome: "success",
        actorUserId: actor.id,
        workspaceId,
        targetType: "membership",
        targetId: target.membershipId,
        metadata: { from: target.role, to: role },
      });
      const name = await this.workspaceName(tx, workspaceId);
      await this.notices.toUser(target.userId, "team.role_changed", (locale) =>
        renderRoleChanged(locale, { workspaceName: name, from: target.role, to: role }),
      );
    }
    return { ...target, role, joinedAt: target.joinedAt.toISOString() };
  }

  async remove(actor: Actor, workspaceId: string, membershipId: string): Promise<void> {
    const tx = this.requestDb.current();
    const target = await this.find(tx, actor.id, workspaceId, membershipId);
    await this.authorize(actor, workspaceId, target, "member.removed");
    const name = await this.workspaceName(tx, workspaceId);
    await revokeInvitationsSentBy(tx, workspaceId, target.userId);
    // Access ends at once: every request derives the role from this row (FR-025, SC-006).
    const removed = await tx
      .delete(membership)
      .where(and(eq(membership.id, target.membershipId), eq(membership.workspaceId, workspaceId)))
      .returning({ id: membership.id });
    // Logged as a success only if the row really went (T103).
    if (removed.length === 0) throw new ApiProblem(404, "not_found");
    await this.securityLog.record({
      type: "member.removed",
      outcome: "success",
      actorUserId: actor.id,
      workspaceId,
      targetType: "membership",
      targetId: target.membershipId,
      metadata: { role: target.role },
    });
    await this.tenancy.forgetWorkspace(target.userId, workspaceId);
    await this.notices.toUser(target.userId, "team.member_removed", (locale) =>
      renderMemberRemoved(locale, name),
    );
  }

  /** Never the owner, never oneself; attempts on the owner are logged (AC-SEC-003). */
  private async authorize(
    actor: Actor,
    workspaceId: string,
    target: { role: Role; userId: string; membershipId: string },
    eventType: "member.role_changed" | "member.removed",
  ): Promise<void> {
    if (canManageMember({ role: actor.role, userId: actor.id }, target)) return;
    if (target.role === "owner") {
      await this.securityLog.record({
        type: eventType,
        outcome: "denied",
        actorUserId: actor.id,
        workspaceId,
        targetType: "membership",
        targetId: target.membershipId,
        metadata: { reason: "owner_target" },
      });
    }
    throw new ApiProblem(
      403,
      "forbidden",
      target.role === "owner"
        ? "The owner can't be changed or removed. Ownership moves only by transfer."
        : "You can't change or remove yourself here.",
    );
  }

  private async find(tx: Transaction, actorId: string, workspaceId: string, membershipId: string) {
    const [row] = /^[0-9a-f-]{36}$/i.test(membershipId)
      ? await tx
          .select({
            membershipId: membership.id,
            userId: membership.userId,
            role: membership.role,
            joinedAt: membership.createdAt,
            name: user.name,
            email: user.email,
          })
          .from(membership)
          .innerJoin(user, eq(user.id, membership.userId))
          .where(and(eq(membership.id, membershipId), eq(membership.workspaceId, workspaceId)))
          .limit(1)
      : [];
    if (!row)
      throw await this.crossTenant.notFound(actorId, workspaceId, "membership", membershipId);
    return row;
  }

  private async workspaceName(tx: Transaction, workspaceId: string): Promise<string> {
    const [row] = await tx
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    return row?.name ?? "Guidesk";
  }
}
