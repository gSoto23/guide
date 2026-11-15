import { Inject, Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { requiresMfa, type PropertyCountProvider } from "@guidesk/domain";
import { membership, user, workspace } from "@guidesk/db";
import {
  renderOwnershipTransferred,
  renderWorkspaceDeletionScheduled,
  renderWorkspaceRestored,
} from "@guidesk/emails";
import type { WorkspaceDeletionResponse } from "@guidesk/contracts";
import { AssuranceService } from "../auth/assurance.service.js";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "./cross-tenant.js";
import { MemberNotices } from "./member-notices.js";
import { PROPERTY_COUNT } from "./property-count.js";
import { TenancyService } from "./tenancy.service.js";

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } };
  const code = e.code ?? e.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Leaving, ownership transfer, deletion, and restore (FR-026, FR-027, T093, T094). Owner-only
 * state changes go through SECURITY DEFINER functions that check ownership again.
 */
@Injectable()
export class WorkspaceLifecycleService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
    private readonly notices: MemberNotices,
    private readonly tenancy: TenancyService,
    private readonly assurance: AssuranceService,
    @Inject(PROPERTY_COUNT) private readonly properties: PropertyCountProvider,
  ) {}

  /** Any member except the owner, who must transfer ownership first (FR-026). */
  async leave(userId: string, role: string, workspaceId: string): Promise<void> {
    if (role === "owner") {
      throw new ApiProblem(
        409,
        "owner_must_transfer",
        "Transfer ownership to an admin before leaving.",
      );
    }
    await this.requestDb
      .current()
      .delete(membership)
      .where(and(eq(membership.workspaceId, workspaceId), eq(membership.userId, userId)));
    await this.securityLog.record({
      type: "member.left",
      outcome: "success",
      actorUserId: userId,
      workspaceId,
    });
    await this.tenancy.forgetWorkspace(userId, workspaceId);
  }

  async transferOwnership(ownerId: string, workspaceId: string, membershipId: string) {
    const tx = this.requestDb.current();
    const [target] = await tx
      .select({
        userId: membership.userId,
        role: membership.role,
        name: user.name,
        email: user.email,
      })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(and(eq(membership.id, membershipId), eq(membership.workspaceId, workspaceId)))
      .limit(1);
    if (!target)
      throw await this.crossTenant.notFound(ownerId, workspaceId, "membership", membershipId);
    if (target.role !== "admin") {
      throw new ApiProblem(409, "target_not_admin", "Ownership can only go to an admin.");
    }
    // Above the threshold, the new owner must already have a second factor (spec edge case).
    const propertyCount = await this.properties.countProperties(workspaceId);
    if (requiresMfa({ isStaff: false, role: "owner", propertyCount })) {
      const factors = await this.assurance.factors(target.userId);
      if (!factors.hasPasskey && !factors.totpEnabled) {
        throw new ApiProblem(
          409,
          "target_mfa_required",
          "The new owner must add a passkey or an authenticator app first.",
        );
      }
    }
    try {
      await tx.execute(
        sql`SELECT * FROM transfer_ownership(${workspaceId}::uuid, ${membershipId}::uuid)`,
      );
    } catch (error) {
      if (pgCode(error) === "GD409") {
        throw new ApiProblem(409, "target_not_admin", "Ownership can only go to an admin.");
      }
      throw error;
    }
    const name = await this.name(workspaceId);
    const newOwnerName = target.name || target.email;
    await this.notices.toUser(target.userId, "team.ownership_transferred", (locale) =>
      renderOwnershipTransferred(locale, {
        workspaceName: name,
        newOwnerName,
        recipientIsNewOwner: true,
      }),
    );
    await this.notices.toUser(ownerId, "team.ownership_transferred", (locale) =>
      renderOwnershipTransferred(locale, {
        workspaceName: name,
        newOwnerName,
        recipientIsNewOwner: false,
      }),
    );
  }

  /** Needs the exact workspace name typed (FR-027); restorable for 30 days. */
  async scheduleDeletion(
    workspaceId: string,
    confirmName: string,
  ): Promise<WorkspaceDeletionResponse> {
    const name = await this.name(workspaceId);
    if (confirmName.trim() !== name) {
      throw new ApiProblem(422, "validation_failed", "Type the workspace name to confirm.", {
        fields: { confirmName: ["Does not match the workspace name"] },
      });
    }
    const result = await this.requestDb
      .current()
      .execute<{ purge_after: string | Date }>(
        sql`SELECT schedule_workspace_deletion(${workspaceId}::uuid) AS purge_after`,
      );
    const purgeAfter = new Date(result.rows[0]?.purge_after ?? Date.now());
    await this.notices.toMembers(workspaceId, "workspace.deletion_scheduled", (locale) =>
      renderWorkspaceDeletionScheduled(locale, { workspaceName: name, purgeAfter }),
    );
    return { status: "pending_deletion", purgeAfter: purgeAfter.toISOString() };
  }

  async restore(workspaceId: string): Promise<void> {
    try {
      await this.requestDb.current().execute(sql`SELECT restore_workspace(${workspaceId}::uuid)`);
    } catch (error) {
      if (pgCode(error) === "GD410") {
        throw new ApiProblem(410, "gone", "This workspace can no longer be restored.");
      }
      throw error;
    }
    const name = await this.name(workspaceId);
    await this.notices.toMembers(workspaceId, "workspace.restored", (locale) =>
      renderWorkspaceRestored(locale, name),
    );
  }

  private async name(workspaceId: string): Promise<string> {
    const [row] = await this.requestDb
      .current()
      .select({ name: workspace.name })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    if (!row) throw new ApiProblem(404, "not_found");
    return row.name;
  }
}
