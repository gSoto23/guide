import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { PropertyAssistantSettings, WorkspaceAssistantSettings } from "@guidesk/contracts";
import { property, workspace } from "@guidesk/db";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";

type Autonomy = "draft" | "auto";

/**
 * The assistant's autonomy (feature 005 US4, FR-022): a workspace default (`draft` at first) and an
 * optional per-property override. Owners and admins change it (the routes' capabilities and the
 * UPDATE policies); every change is in the security log.
 */
@Injectable()
export class AssistantSettingsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  private async workspaceAutonomy(workspaceId: string): Promise<Autonomy> {
    const [row] = await this.tx
      .select({ autonomy: workspace.assistantAutonomy })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    if (!row) throw new ApiProblem(404, "not_found");
    return row.autonomy;
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceAssistantSettings> {
    return { autonomy: await this.workspaceAutonomy(workspaceId) };
  }

  async setWorkspace(
    userId: string,
    workspaceId: string,
    autonomy: Autonomy,
  ): Promise<WorkspaceAssistantSettings> {
    const before = await this.workspaceAutonomy(workspaceId);
    if (before !== autonomy) {
      await this.tx
        .update(workspace)
        .set({ assistantAutonomy: autonomy })
        .where(eq(workspace.id, workspaceId));
      await this.securityLog.record({
        type: "assistant.autonomy_changed",
        outcome: "success",
        actorUserId: userId,
        workspaceId,
        targetType: "workspace",
        targetId: workspaceId,
        metadata: { autonomy },
      });
    }
    return { autonomy };
  }

  private async propertyOverride(
    workspaceId: string,
    propertyId: string,
  ): Promise<Autonomy | null> {
    const [row] = await this.tx
      .select({ autonomy: property.assistantAutonomy })
      .from(property)
      .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "property", propertyId);
    }
    return row.autonomy;
  }

  async getProperty(workspaceId: string, propertyId: string): Promise<PropertyAssistantSettings> {
    const override = await this.propertyOverride(workspaceId, propertyId);
    return { override, effective: override ?? (await this.workspaceAutonomy(workspaceId)) };
  }

  async setProperty(
    userId: string,
    workspaceId: string,
    propertyId: string,
    override: Autonomy | null,
  ): Promise<PropertyAssistantSettings> {
    const before = await this.propertyOverride(workspaceId, propertyId);
    if (before !== override) {
      await this.tx
        .update(property)
        .set({ assistantAutonomy: override })
        .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)));
      await this.securityLog.record({
        type: "assistant.autonomy_changed",
        outcome: "success",
        actorUserId: userId,
        workspaceId,
        targetType: "property",
        targetId: propertyId,
        metadata: { propertyId, autonomy: override ?? "default" },
      });
    }
    return { override, effective: override ?? (await this.workspaceAutonomy(workspaceId)) };
  }
}
