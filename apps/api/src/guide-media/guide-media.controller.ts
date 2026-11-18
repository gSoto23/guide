import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createMediaSchema,
  type CreateMediaBody,
  type MediaUpload,
  type MediaView,
} from "@guidesk/contracts";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { GuideMediaService } from "./guide-media.service.js";

/** /api/v1/workspaces/{workspaceId}/properties/{propertyId}/guide/media (feature 003 contract). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/guide/media")
export class GuideMediaController {
  constructor(private readonly media: GuideMediaService) {}

  @Post()
  @WorkspaceAction({ capability: "properties.manage" })
  @Idempotent()
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(createMediaSchema)) body: CreateMediaBody,
  ): Promise<MediaUpload> {
    return this.media.create(callerOf(request), workspaceId, propertyId, body);
  }

  @Post(":mediaId/complete")
  @HttpCode(202)
  @WorkspaceAction({ capability: "properties.manage" })
  complete(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("mediaId") mediaId: string,
  ): Promise<MediaView> {
    return this.media.complete(workspaceId, propertyId, mediaId);
  }

  @Get(":mediaId")
  @WorkspaceAction()
  view(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("mediaId") mediaId: string,
  ): Promise<MediaView> {
    return this.media.view(workspaceId, propertyId, mediaId);
  }
}
