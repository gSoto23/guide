import { Controller, Get, Param, Query } from "@nestjs/common";
import {
  analyticsQuerySchema,
  unansweredQuerySchema,
  type AnalyticsQuery,
  type AnalyticsSummary,
  type UnansweredPage,
  type UnansweredQuery,
} from "@guidesk/contracts";
import type { AnalyticsPeriod } from "@guidesk/domain";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { AnalyticsService } from "./analytics.service.js";

/** Every member who can see conversations (owners, admins, agents) sees analytics (FR-002). */
const HANDLE = { capability: "conversations.handle" } as const;

const periodOf = (value: "7" | "30" | "90") => Number(value) as AnalyticsPeriod;

/** /api/v1/workspaces/{ws}/analytics (feature 010 contracts). */
@Controller("v1/workspaces/:workspaceId/analytics")
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @WorkspaceAction(HANDLE)
  summary(
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<AnalyticsSummary> {
    return this.analytics.summary(workspaceId, periodOf(query.period), query.propertyId);
  }

  @Get("unanswered")
  @WorkspaceAction(HANDLE)
  unanswered(
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(unansweredQuerySchema)) query: UnansweredQuery,
  ): Promise<UnansweredPage> {
    return this.analytics.unanswered(
      workspaceId,
      periodOf(query.period),
      query.propertyId,
      query.cursor,
    );
  }
}
