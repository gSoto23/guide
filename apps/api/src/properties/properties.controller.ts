import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  addressCheckQuerySchema,
  confirmPropertiesSchema,
  createPropertySchema,
  duplicateDraftQuerySchema,
  listPropertiesQuerySchema,
  removePropertyQuerySchema,
  removePropertySchema,
  updatePropertySchema,
  type AddressCheck,
  type AddressCheckQuery,
  type ConfirmPropertiesBody,
  type ConfirmPropertiesResult,
  type CreatePropertyBody,
  type DuplicateDraft,
  type ListPropertiesQuery,
  type PropertyDetail,
  type PropertyLimits,
  type PropertyList,
  type PropertyRemoval,
  type RemovePropertyBody,
  type RestrictedValueList,
  type StartOptions,
  type UpdatePropertyBody,
} from "@guidesk/contracts";
import { StepUpUnlessDryRunGuard } from "../auth/step-up.guard.js";
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

  /** "Confirm all" for imported properties in `to_confirm` (FR-004, T094). */
  @Post("confirm")
  @HttpCode(200)
  @WorkspaceAction({ capability: "properties.manage" })
  confirm(
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(confirmPropertiesSchema)) body: ConfirmPropertiesBody,
  ): Promise<ConfirmPropertiesResult> {
    return this.properties.confirm(workspaceId, body.propertyIds);
  }

  /** Codes found in imported text, masked (FR-031, T100); agents get 404. */
  @Get(":propertyId/restricted-values")
  @WorkspaceAction({ capability: "properties.manage", deniedAs: "not_found" })
  restrictedValues(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<RestrictedValueList> {
    return this.properties.restrictedValues(callerOf(request), workspaceId, propertyId);
  }

  /** The confirmation step's prefill for a copy (FR-043, T116). */
  @Get(":propertyId/duplicate-draft")
  @WorkspaceAction({ capability: "properties.manage" })
  duplicateDraft(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Query(new ZodValidationPipe(duplicateDraftQuerySchema)) query: { lang: "es" | "en" },
  ): Promise<DuplicateDraft> {
    return this.properties.duplicateDraft(callerOf(request), workspaceId, propertyId, query.lang);
  }

  /**
   * Removes a property for 30 days (FR-044, T117): the typed name and a recent sign-in. The
   * step-up guard runs after the role check, and `?dryRun=true` needs no step-up.
   */
  @Delete(":propertyId")
  @HttpCode(200)
  @UseGuards(StepUpUnlessDryRunGuard)
  @WorkspaceAction({ capability: "properties.manage" })
  remove(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Query(new ZodValidationPipe(removePropertyQuerySchema)) query: { dryRun: "true" | "false" },
    @Body(new ZodValidationPipe(removePropertySchema)) body: RemovePropertyBody,
  ): Promise<PropertyRemoval> {
    return this.properties.remove(callerOf(request), workspaceId, propertyId, {
      typedName: body?.typedName,
      dryRun: query.dryRun === "true",
    });
  }

  /** Restores a removed property within 30 days, with a free slot (FR-045, T117). */
  @Post(":propertyId/restore")
  @HttpCode(200)
  @WorkspaceAction({ capability: "properties.manage" })
  restore(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<PropertyDetail> {
    return this.properties.restore(callerOf(request), workspaceId, propertyId);
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
