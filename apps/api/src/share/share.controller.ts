import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  regeneratePropertyLinkSchema,
  shareSettingsSchema,
  type ShareOverview,
  type ShareSettingsBody,
  type StayLinkCopy,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { ShareService } from "./share.service.js";

const MANAGE = { capability: "properties.manage" } as const;
/** A stay link shows codes to whoever opens it: owners and admins, after a recent sign-in. */
const STAY_LINKS = { capability: "restricted.reveal", stepUp: true } as const;
const STAY_LINKS_NO_STEP_UP = { capability: "restricted.reveal" } as const;

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

  @Post("stays/:stayId/link")
  @HttpCode(200)
  @WorkspaceAction(STAY_LINKS)
  copyStayLink(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("stayId") stayId: string,
  ): Promise<StayLinkCopy> {
    assertUuid(stayId);
    return this.share.copyStayLink(callerOf(request), workspaceId, propertyId, stayId);
  }

  @Post("stays/:stayId/link/regenerate")
  @HttpCode(200)
  @WorkspaceAction(STAY_LINKS)
  regenerateStayLink(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("stayId") stayId: string,
  ): Promise<StayLinkCopy> {
    assertUuid(stayId);
    return this.share.regenerateStayLink(callerOf(request), workspaceId, propertyId, stayId);
  }

  @Post("stays/:stayId/link/revoke")
  @HttpCode(204)
  @WorkspaceAction(STAY_LINKS_NO_STEP_UP)
  async revokeStayLink(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("stayId") stayId: string,
  ): Promise<void> {
    assertUuid(stayId);
    await this.share.revokeStayLink(callerOf(request), workspaceId, propertyId, stayId);
  }

  @Patch("settings")
  @WorkspaceAction(MANAGE)
  settings(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(shareSettingsSchema)) body: ShareSettingsBody,
  ): Promise<{ requireConfirmationCode: boolean }> {
    return this.share.setSettings(
      callerOf(request),
      workspaceId,
      propertyId,
      body.requireConfirmationCode,
    );
  }
}
