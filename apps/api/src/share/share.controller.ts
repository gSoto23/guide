import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { regeneratePropertyLinkSchema, type ShareOverview } from "@guidesk/contracts";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { ShareService } from "./share.service.js";

const MANAGE = { capability: "properties.manage" } as const;

/** /api/v1/workspaces/{workspaceId}/properties/{propertyId}/share (feature 004 contract). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/share")
export class ShareController {
  constructor(private readonly share: ShareService) {}

  @Get()
  @WorkspaceAction()
  overview(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<ShareOverview> {
    return this.share.overview(callerOf(request), workspaceId, propertyId);
  }

  @Post("property-link/regenerate")
  @HttpCode(200)
  @WorkspaceAction(MANAGE)
  regenerate(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(regeneratePropertyLinkSchema)) _body: { confirm: true },
  ): Promise<ShareOverview["propertyLink"]> {
    return this.share.regeneratePropertyLink(callerOf(request), workspaceId, propertyId);
  }

  @Get("qr.svg")
  @WorkspaceAction()
  async qrSvg(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const qr = await this.share.qr(callerOf(request), workspaceId, propertyId, "svg");
    await reply
      .header("content-type", "image/svg+xml")
      .header("content-disposition", `attachment; filename="${qr.fileName}"`)
      .send(qr.body);
  }

  @Get("qr.png")
  @WorkspaceAction()
  async qrPng(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const qr = await this.share.qr(callerOf(request), workspaceId, propertyId, "png");
    await reply
      .header("content-type", "image/png")
      .header("content-disposition", `attachment; filename="${qr.fileName}"`)
      .send(qr.body);
  }
}
