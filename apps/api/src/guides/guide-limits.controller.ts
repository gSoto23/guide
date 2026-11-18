import { Controller, Get, Param } from "@nestjs/common";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { GuideLimitsService, type GuideLimits } from "./guide-limits.service.js";

/** GET /api/v1/workspaces/{workspaceId}/guide-limits (feature 003 contract, FR-064, FR-065). */
@Controller("v1/workspaces/:workspaceId/guide-limits")
export class GuideLimitsController {
  constructor(private readonly limits: GuideLimitsService) {}

  @Get()
  @WorkspaceAction()
  get(@Param("workspaceId") workspaceId: string): Promise<GuideLimits> {
    return this.limits.limitsOf(workspaceId);
  }
}
