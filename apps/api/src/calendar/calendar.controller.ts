import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  calendarQuerySchema,
  type CalendarQuery,
  type CalendarResponse,
  type StayOverview,
} from "@guidesk/contracts";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { CalendarService } from "./calendar.service.js";

/** Accept-Language decides the language of add-on names in the stay view. */
function languageOf(request: FastifyRequest): "es" | "en" {
  const header = request.headers["accept-language"];
  return typeof header === "string" && header.toLowerCase().startsWith("en") ? "en" : "es";
}

/**
 * The stay calendar and the stay view (feature 018 contracts/http-api.md). Any member reads them,
 * as for the stays list; nothing here writes.
 */
@Controller("v1/workspaces/:workspaceId")
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Get("calendar")
  @WorkspaceAction()
  calendar(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(calendarQuerySchema)) query: CalendarQuery,
  ): Promise<CalendarResponse> {
    return this.calendarService.calendar(
      { ...callerOf(request), language: languageOf(request) },
      workspaceId,
      query,
    );
  }

  @Get("stays/:stayId")
  @WorkspaceAction()
  overview(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("stayId") stayId: string,
  ): Promise<StayOverview> {
    return this.calendarService.overview(
      { ...callerOf(request), language: languageOf(request) },
      workspaceId,
      stayId,
    );
  }
}
