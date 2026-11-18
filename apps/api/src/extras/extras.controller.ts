import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  extraCopySchema,
  extraInputSchema,
  extrasOrderSchema,
  extraUpdateSchema,
  serviceRequestAnswerSchema,
  serviceRequestsQuerySchema,
  type ExtraInput,
  type ExtraUpdateBody,
  type MemberExtra,
  type MemberExtras,
  type MemberServiceRequest,
  type ServiceRequestAnswerBody,
  type ServiceRequestPage,
  type ServiceRequestsQuery,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { ExtrasService } from "./extras.service.js";
import { ServiceRequestsService } from "./service-requests.service.js";

/** Owners and admins edit the catalog, as they edit the guide (research R4). */
const MANAGE = { capability: "properties.manage" } as const;
/** Members who handle conversations answer requests (research R4). */
const HANDLE = { capability: "conversations.handle" } as const;

const languageOf = (value: unknown): "es" | "en" => (value === "en" ? "en" : "es");

/** /api/v1/workspaces/{ws}/properties/{pid}/extras (feature 008 contracts). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/extras")
export class PropertyExtrasController {
  constructor(private readonly extras: ExtrasService) {}

  @Get()
  @WorkspaceAction()
  list(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<MemberExtras> {
    assertUuid(propertyId);
    return this.extras.list(callerOf(request), workspaceId, propertyId);
  }

  @Post()
  @WorkspaceAction(MANAGE)
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(extraInputSchema)) body: ExtraInput,
  ): Promise<MemberExtra> {
    assertUuid(propertyId);
    return this.extras.create(callerOf(request), workspaceId, propertyId, body);
  }

  @Put("order")
  @WorkspaceAction(MANAGE)
  order(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(extrasOrderSchema)) body: { ids: string[] },
  ): Promise<MemberExtras> {
    assertUuid(propertyId);
    return this.extras.order(callerOf(request), workspaceId, propertyId, body.ids);
  }

  @Put(":extraId")
  @WorkspaceAction(MANAGE)
  update(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("extraId") extraId: string,
    @Body(new ZodValidationPipe(extraUpdateSchema)) body: ExtraUpdateBody,
  ): Promise<MemberExtra> {
    assertUuid(propertyId);
    assertUuid(extraId);
    return this.extras.update(
      callerOf(request),
      workspaceId,
      propertyId,
      extraId,
      body.version,
      body.extra,
    );
  }

  @Delete(":extraId")
  @HttpCode(204)
  @WorkspaceAction(MANAGE)
  async remove(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("extraId") extraId: string,
  ): Promise<void> {
    assertUuid(propertyId);
    assertUuid(extraId);
    await this.extras.remove(callerOf(request), workspaceId, propertyId, extraId);
  }

  @Post(":extraId/copy")
  @HttpCode(200)
  @WorkspaceAction(MANAGE)
  copy(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("extraId") extraId: string,
    @Body(new ZodValidationPipe(extraCopySchema)) body: { propertyIds: string[] },
  ): Promise<{ copied: number }> {
    assertUuid(propertyId);
    assertUuid(extraId);
    return this.extras.copy(callerOf(request), workspaceId, propertyId, extraId, body.propertyIds);
  }
}

/** /api/v1/workspaces/{ws}/service-requests (feature 008 contracts). */
@Controller("v1/workspaces/:workspaceId/service-requests")
export class ServiceRequestsController {
  constructor(private readonly requests: ServiceRequestsService) {}

  @Get()
  @WorkspaceAction()
  list(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(serviceRequestsQuerySchema)) query: ServiceRequestsQuery,
  ): Promise<ServiceRequestPage> {
    return this.requests.list(
      { userId: callerOf(request).userId, language: languageOf(query.lang) },
      workspaceId,
      query,
    );
  }

  @Post(":requestId/confirm")
  @HttpCode(200)
  @WorkspaceAction(HANDLE)
  confirm(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("requestId") requestId: string,
    @Query("lang") lang: unknown,
  ): Promise<MemberServiceRequest> {
    assertUuid(requestId);
    return this.requests.confirm(
      { userId: callerOf(request).userId, language: languageOf(lang) },
      workspaceId,
      requestId,
    );
  }

  @Post(":requestId/decline")
  @HttpCode(200)
  @WorkspaceAction(HANDLE)
  decline(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("requestId") requestId: string,
    @Query("lang") lang: unknown,
    @Body(new ZodValidationPipe(serviceRequestAnswerSchema)) body: ServiceRequestAnswerBody,
  ): Promise<MemberServiceRequest> {
    assertUuid(requestId);
    return this.requests.decline(
      { userId: callerOf(request).userId, language: languageOf(lang) },
      workspaceId,
      requestId,
      body,
    );
  }

  @Post(":requestId/cancel")
  @HttpCode(200)
  @WorkspaceAction(HANDLE)
  cancel(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("requestId") requestId: string,
    @Query("lang") lang: unknown,
    @Body(new ZodValidationPipe(serviceRequestAnswerSchema)) body: ServiceRequestAnswerBody,
  ): Promise<MemberServiceRequest> {
    assertUuid(requestId);
    return this.requests.cancel(
      { userId: callerOf(request).userId, language: languageOf(lang) },
      workspaceId,
      requestId,
      body,
    );
  }
}
