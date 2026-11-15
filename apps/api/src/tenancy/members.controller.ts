import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  changeRoleSchema,
  type ChangeRoleBody,
  type Member,
  type MemberList,
} from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { MembersService } from "./members.service.js";
import { WorkspaceAction } from "./workspace-access.guard.js";

function actorOf(request: FastifyRequest) {
  if (!request.auth || !request.workspaceRole) throw new ApiProblem(401, "unauthenticated");
  return { id: request.auth.user.id, role: request.workspaceRole };
}

/** /api/v1/workspaces/{workspaceId}/members (contracts/http-api.md, T092). */
@Controller("v1/workspaces/:workspaceId/members")
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @WorkspaceAction({ capability: "members.manage" })
  list(@Param("workspaceId") workspaceId: string): Promise<MemberList> {
    return this.members.list(workspaceId);
  }

  @Patch(":membershipId")
  @WorkspaceAction({ capability: "members.manage", stepUp: true, mfa: true })
  changeRole(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("membershipId") membershipId: string,
    @Body(new ZodValidationPipe(changeRoleSchema)) body: ChangeRoleBody,
  ): Promise<Member> {
    return this.members.changeRole(actorOf(request), workspaceId, membershipId, body.role);
  }

  @Delete(":membershipId")
  @HttpCode(204)
  @WorkspaceAction({ capability: "members.manage", stepUp: true, mfa: true })
  async remove(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("membershipId") membershipId: string,
  ): Promise<void> {
    await this.members.remove(actorOf(request), workspaceId, membershipId);
  }
}
