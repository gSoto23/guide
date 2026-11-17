import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createCalendarFeedSchema,
  updateCalendarFeedSchema,
  type CalendarFeed,
  type CalendarFeedList,
  type CreateCalendarFeedBody,
  type CreatedCalendarFeed,
  type UpdateCalendarFeedBody,
} from "@guidesk/contracts";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { CalendarFeedsService } from "./calendar-feeds.service.js";

/** Owners and admins only; agents get 404, so a feed's existence is not revealed (FR-025). */
const FEED_ACCESS = { capability: "properties.manage", deniedAs: "not_found" } as const;

/** Calendar feed routes (feature 002 contracts/http-api.md, T075). */
@Controller("v1/workspaces/:workspaceId")
export class CalendarFeedsController {
  constructor(private readonly feeds: CalendarFeedsService) {}

  @Get("properties/:propertyId/calendar-feeds")
  @WorkspaceAction(FEED_ACCESS)
  list(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<CalendarFeedList> {
    return this.feeds.list(callerOf(request), workspaceId, propertyId);
  }

  @Post("properties/:propertyId/calendar-feeds")
  @HttpCode(201)
  @Idempotent()
  @WorkspaceAction(FEED_ACCESS)
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(createCalendarFeedSchema)) body: CreateCalendarFeedBody,
  ): Promise<CreatedCalendarFeed> {
    return this.feeds.create(callerOf(request), workspaceId, propertyId, body);
  }

  @Post("properties/:propertyId/calendar-feeds/refresh")
  @HttpCode(202)
  @WorkspaceAction(FEED_ACCESS)
  async refresh(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<void> {
    await this.feeds.refreshNow(callerOf(request), workspaceId, propertyId);
  }

  @Patch("calendar-feeds/:feedId")
  @WorkspaceAction(FEED_ACCESS)
  update(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("feedId") feedId: string,
    @Body(new ZodValidationPipe(updateCalendarFeedSchema)) body: UpdateCalendarFeedBody,
  ): Promise<CalendarFeed> {
    return this.feeds.update(callerOf(request), workspaceId, feedId, body);
  }

  @Delete("calendar-feeds/:feedId")
  @HttpCode(204)
  @WorkspaceAction(FEED_ACCESS)
  async remove(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("feedId") feedId: string,
  ): Promise<void> {
    await this.feeds.remove(callerOf(request), workspaceId, feedId);
  }
}
