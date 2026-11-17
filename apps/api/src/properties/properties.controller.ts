import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  addressCheckQuerySchema,
  createPropertySchema,
  listPropertiesQuerySchema,
  updatePropertySchema,
  type AddressCheck,
  type AddressCheckQuery,
  type CreatePropertyBody,
  type ListPropertiesQuery,
  type PropertyDetail,
  type PropertyLimits,
  type PropertyList,
  type StartOptions,
  type UpdatePropertyBody,
} from "@guidesk/contracts";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ApiProblem } from "../common/problem.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { PropertiesService } from "./properties.service.js";

/** The signed-in caller and their role in the route's workspace (set by WorkspaceAccessGuard). */
export function callerOf(request: FastifyRequest) {
  if (!request.auth || !request.workspaceRole) throw new ApiProblem(401, "unauthenticated");
  return { userId: request.auth.user.id, role: request.workspaceRole };
}

/** /api/v1/workspaces/{workspaceId}/properties (feature 002 contracts/http-api.md, T042). */
@Controller("v1/workspaces/:workspaceId/properties")
export class PropertiesController {
  constructor(private readonly properties: PropertiesService) {}

  @Get()
  @WorkspaceAction()
  list(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(listPropertiesQuerySchema)) query: ListPropertiesQuery,
  ): Promise<PropertyList> {
    return this.properties.list(callerOf(request), workspaceId, query);
  }

  @Get("limits")
  @WorkspaceAction()
  limits(@Param("workspaceId") workspaceId: string): Promise<PropertyLimits> {
    return this.properties.limitsOf(workspaceId);
  }

  @Get("start-options")
  @WorkspaceAction({ capability: "properties.manage" })
  startOptions(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
  ): Promise<StartOptions> {
    return this.properties.startOptions(callerOf(request), workspaceId);
  }

  @Get("address-check")
  @WorkspaceAction({ capability: "properties.manage" })
  addressCheck(
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(addressCheckQuerySchema)) query: AddressCheckQuery,
  ): Promise<AddressCheck> {
    return this.properties.addressCheck(workspaceId, query);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @WorkspaceAction({ capability: "properties.manage", mfa: true })
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createPropertySchema)) body: CreatePropertyBody,
  ): Promise<PropertyDetail> {
    return this.properties.create(callerOf(request), workspaceId, body);
  }

  @Get(":propertyId")
  @WorkspaceAction()
  get(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<PropertyDetail> {
    return this.properties.get(callerOf(request), workspaceId, propertyId);
  }

  @Patch(":propertyId")
  @WorkspaceAction({ capability: "properties.manage" })
  update(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(updatePropertySchema)) body: UpdatePropertyBody,
  ): Promise<PropertyDetail> {
    return this.properties.update(callerOf(request), workspaceId, propertyId, body);
  }
}
