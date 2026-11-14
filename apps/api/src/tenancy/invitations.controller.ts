import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createInvitationSchema,
  type CreateInvitationBody,
  type Invitation,
  type InvitationList,
} from "@guidesk/contracts";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ApiProblem } from "../common/problem.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { InvitationsService } from "./invitations.service.js";
import { WorkspaceAction } from "./workspace-access.guard.js";

function userOf(request: FastifyRequest) {
  if (!request.auth) throw new ApiProblem(401, "unauthenticated");
  return request.auth.user;
}

/** /api/v1/workspaces/{workspaceId}/invitations (contracts/http-api.md, T074). */
@Controller("v1/workspaces/:workspaceId/invitations")
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @WorkspaceAction({ capability: "members.manage" })
  list(@Param("workspaceId") workspaceId: string): Promise<InvitationList> {
    return this.invitations.list(workspaceId);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @WorkspaceAction({ capability: "members.manage", stepUp: true, mfa: true })
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createInvitationSchema)) body: CreateInvitationBody,
  ): Promise<Invitation> {
    return this.invitations.create(userOf(request), workspaceId, body);
  }

  @Post(":invitationId/resend")
  @HttpCode(202)
  @WorkspaceAction({ capability: "members.manage" })
  async resend(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("invitationId") invitationId: string,
  ): Promise<void> {
    await this.invitations.resend(userOf(request), workspaceId, invitationId);
  }

  @Delete(":invitationId")
  @HttpCode(204)
  @WorkspaceAction({ capability: "members.manage" })
  async revoke(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("invitationId") invitationId: string,
  ): Promise<void> {
    await this.invitations.revoke(userOf(request), workspaceId, invitationId);
  }
}
