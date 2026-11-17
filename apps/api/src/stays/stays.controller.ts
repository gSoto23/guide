import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createStaySchema,
  listStaysQuerySchema,
  updateStaySchema,
  type CreateStayBody,
  type ListStaysQuery,
  type Stay,
  type StayList,
  type UpdateStayBody,
} from "@guidesk/contracts";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { StaysService } from "./stays.service.js";

/** Stay routes (feature 002 contracts/http-api.md, T076). Agents read stays (FR-046). */
@Controller("v1/workspaces/:workspaceId")
export class StaysController {
  constructor(private readonly stays: StaysService) {}

  @Get("properties/:propertyId/stays")
  @WorkspaceAction()
  list(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Query(new ZodValidationPipe(listStaysQuerySchema)) query: ListStaysQuery,
  ): Promise<StayList> {
    return this.stays.list(callerOf(request), workspaceId, propertyId, query);
  }

  @Post("properties/:propertyId/stays")
  @HttpCode(201)
  @Idempotent()
  @WorkspaceAction({ capability: "properties.manage" })
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(createStaySchema)) body: CreateStayBody,
  ): Promise<Stay> {
    return this.stays.create(callerOf(request), workspaceId, propertyId, body);
  }

  @Patch("stays/:stayId")
  @WorkspaceAction({ capability: "properties.manage" })
  update(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("stayId") stayId: string,
    @Body(new ZodValidationPipe(updateStaySchema)) body: UpdateStayBody,
  ): Promise<Stay> {
    return this.stays.update(callerOf(request), workspaceId, stayId, body);
  }

  @Post("stays/:stayId/cancel")
  @HttpCode(200)
  @WorkspaceAction({ capability: "properties.manage" })
  cancel(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("stayId") stayId: string,
  ): Promise<Stay> {
    return this.stays.cancel(callerOf(request), workspaceId, stayId);
  }

  @Post("stays/:stayId/remove-guest-name")
  @HttpCode(200)
  @WorkspaceAction({ capability: "properties.manage" })
  removeGuestName(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("stayId") stayId: string,
  ): Promise<Stay> {
    return this.stays.removeGuestName(callerOf(request), workspaceId, stayId);
  }
}
