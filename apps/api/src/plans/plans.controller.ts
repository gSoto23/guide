import { Controller, Get, Param, Query } from "@nestjs/common";
import { planQuerySchema, type PlanSummary } from "@guidesk/contracts";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { PlansService } from "./plans.service.js";

/**
 * /api/v1/workspaces/{ws}/plan (feature 011 contracts): read-only, for owners and admins. There is
 * no route that writes a plan or a custom limit (AC-SEC-002); the founder tool does that.
 */
@Controller("v1/workspaces/:workspaceId/plan")
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @WorkspaceAction({ capability: "workspace.settings" })
  summary(
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(planQuerySchema)) _query: Record<string, never>,
  ): Promise<PlanSummary> {
    return this.plans.summary(workspaceId);
  }
}
