import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { membership, workspace } from "@guidesk/db";
import type { AuthProviderPort, AuthUser } from "@guidesk/integrations";
import type { MeResponse, UpdateMeBody } from "@guidesk/contracts";
import { requiresMfa, type PropertyCountProvider } from "@guidesk/domain";
import { AssuranceService } from "../auth/assurance.service.js";
import { AUTH_PROVIDER } from "../auth/auth.js";
import { ApiProblem } from "../common/problem.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { PROPERTY_COUNT } from "../tenancy/property-count.js";
import { TenancyService } from "../tenancy/tenancy.service.js";
import { RequestDb } from "../database/request-db.js";

function language(value: string | null | undefined): "es" | "en" {
  return value === "en" ? "en" : "es";
}

/** /me (T041): profile from the identity provider, memberships under RLS. */
@Injectable()
export class MeService {
  constructor(
    private readonly requestDb: RequestDb,
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProviderPort,
    private readonly assurance: AssuranceService,
    @Inject(PROPERTY_COUNT) private readonly properties: PropertyCountProvider,
    private readonly tenancy: TenancyService,
    private readonly securityLog: SecurityLogService,
  ) {}

  /**
   * Switches the current workspace (FR-022, FR-024, T083). Only a workspace the caller belongs to
   * and can see (RLS: active, or pending deletion for its owner); anything else is a logged 404.
   */
  async setCurrentWorkspace(authUser: AuthUser, workspaceId: string): Promise<void> {
    const [row] = await this.requestDb
      .current()
      .select({ id: workspace.id })
      .from(membership)
      .innerJoin(workspace, eq(workspace.id, membership.workspaceId))
      .where(and(eq(membership.userId, authUser.id), eq(membership.workspaceId, workspaceId)))
      .limit(1);
    if (!row) {
      await this.securityLog.record({
        type: "access.cross_workspace_denied",
        outcome: "denied",
        actorUserId: authUser.id,
        targetType: "workspace",
        targetId: workspaceId,
      });
      throw new ApiProblem(404, "not_found");
    }
    await this.tenancy.setLastWorkspace(authUser.id, workspaceId);
  }

  async getMe(authUser: AuthUser): Promise<MeResponse> {
    // RLS (membership_read, workspace_read) already limits rows to the caller.
    const rows = await this.requestDb
      .current()
      .select({
        workspaceId: membership.workspaceId,
        role: membership.role,
        workspaceName: workspace.name,
        status: workspace.status,
      })
      .from(membership)
      .innerJoin(workspace, eq(workspace.id, membership.workspaceId))
      .where(eq(membership.userId, authUser.id))
      .orderBy(workspace.createdAt);

    const memberships = rows.map((row) => ({
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      role: row.role,
      status: row.status,
    }));
    const lastWorkspaceId = memberships.some((m) => m.workspaceId === authUser.lastWorkspaceId)
      ? authUser.lastWorkspaceId
      : (memberships[0]?.workspaceId ?? null);

    const factors = await this.assurance.factors(authUser.id);
    const requiresMfaIn: string[] = [];
    for (const m of memberships) {
      const propertyCount = await this.properties.countProperties(m.workspaceId);
      if (requiresMfa({ isStaff: authUser.isStaff, role: m.role, propertyCount })) {
        requiresMfaIn.push(m.workspaceId);
      }
    }

    return {
      user: {
        id: authUser.id,
        email: authUser.email,
        name: authUser.name,
        preferredLanguage: language(authUser.preferredLanguage),
      },
      memberships,
      lastWorkspaceId,
      mfa: { enabled: factors.totpEnabled || factors.hasPasskey },
      requiresMfaIn,
    };
  }

  async updateMe(headers: Headers, authUser: AuthUser, body: UpdateMeBody): Promise<MeResponse> {
    await this.authProvider.updateUser(headers, body);
    return this.getMe({
      ...authUser,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.preferredLanguage !== undefined
        ? { preferredLanguage: body.preferredLanguage }
        : {}),
    });
  }
}
