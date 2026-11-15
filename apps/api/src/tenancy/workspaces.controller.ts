import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { workspace } from "@guidesk/db";
import {
  createWorkspaceSchema,
  deleteWorkspaceSchema,
  transferOwnershipSchema,
  updateWorkspaceSchema,
  type CreateWorkspaceBody,
  type DeleteWorkspaceBody,
  type TransferOwnershipBody,
  type UpdateWorkspaceBody,
  type Workspace,
  type WorkspaceDeletionResponse,
} from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { RequestDb } from "../database/request-db.js";
import { TenancyService } from "./tenancy.service.js";
import { WorkspaceAction } from "./workspace-access.guard.js";
import { WorkspaceLifecycleService } from "./workspace-lifecycle.service.js";

/** New workspaces per user per day: generous for co-hosts, a brake on scripted abuse. */
const CREATES_PER_DAY = 5;

/** /api/v1/workspaces (contracts/http-api.md, T082). */
@Controller("v1/workspaces")
export class WorkspacesController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly requestDb: RequestDb,
    private readonly rateLimit: RateLimitService,
    private readonly lifecycle: WorkspaceLifecycleService,
  ) {}

  /** Any signed-in user can create a workspace; they become its owner and switch to it (FR-023). */
  @Post()
  @HttpCode(201)
  async create(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(createWorkspaceSchema)) body: CreateWorkspaceBody,
  ): Promise<Workspace> {
    if (!request.auth) throw new ApiProblem(401, "unauthenticated");
    const limit = await this.rateLimit.consume(
      `workspace-create:${request.auth.user.id}`,
      CREATES_PER_DAY,
      24 * 60 * 60,
    );
    if (!limit.allowed) {
      throw new ApiProblem(429, "rate_limited", "Too many new workspaces today. Try tomorrow.");
    }
    const created = await this.tenancy.createWorkspace(request.auth.user.id, body.name, "user");
    return {
      id: created.id,
      name: created.name,
      status: "active",
      role: "owner",
      createdAt: created.createdAt.toISOString(),
      purgeAfter: null,
    };
  }

  @Get(":workspaceId")
  @WorkspaceAction({ allowPendingDeletion: true })
  async get(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
  ): Promise<Workspace> {
    return this.read(request, workspaceId);
  }

  @Patch(":workspaceId")
  @WorkspaceAction({ capability: "workspace.settings" })
  async update(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(updateWorkspaceSchema)) body: UpdateWorkspaceBody,
  ): Promise<Workspace> {
    // RLS lets owners and admins change the name column only (migration 0008).
    await this.requestDb
      .current()
      .update(workspace)
      .set({ name: body.name })
      .where(eq(workspace.id, workspaceId));
    return this.read(request, workspaceId);
  }

  @Post(":workspaceId/leave")
  @HttpCode(204)
  @WorkspaceAction()
  async leave(@Req() request: FastifyRequest, @Param("workspaceId") workspaceId: string) {
    if (!request.auth || !request.workspaceRole) throw new ApiProblem(401, "unauthenticated");
    await this.lifecycle.leave(request.auth.user.id, request.workspaceRole, workspaceId);
  }

  @Post(":workspaceId/ownership-transfer")
  @HttpCode(200)
  @WorkspaceAction({ capability: "workspace.ownership", stepUp: true, mfa: true })
  async transfer(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(transferOwnershipSchema)) body: TransferOwnershipBody,
  ): Promise<Workspace> {
    if (!request.auth) throw new ApiProblem(401, "unauthenticated");
    await this.lifecycle.transferOwnership(request.auth.user.id, workspaceId, body.membershipId);
    request.workspaceRole = "admin";
    return this.read(request, workspaceId);
  }

  @Delete(":workspaceId")
  @HttpCode(202)
  @WorkspaceAction({ capability: "workspace.ownership", stepUp: true, mfa: true })
  remove(
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(deleteWorkspaceSchema)) body: DeleteWorkspaceBody,
  ): Promise<WorkspaceDeletionResponse> {
    return this.lifecycle.scheduleDeletion(workspaceId, body.confirmName);
  }

  @Post(":workspaceId/restore")
  @HttpCode(200)
  @WorkspaceAction({ capability: "workspace.ownership", stepUp: true, allowPendingDeletion: true })
  async restore(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
  ): Promise<Workspace> {
    await this.lifecycle.restore(workspaceId);
    return this.read(request, workspaceId);
  }

  private async read(request: FastifyRequest, workspaceId: string): Promise<Workspace> {
    const [row] = await this.requestDb
      .current()
      .select({
        id: workspace.id,
        name: workspace.name,
        status: workspace.status,
        createdAt: workspace.createdAt,
        purgeAfter: workspace.purgeAfter,
      })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    // A workspace pending deletion is visible to its owner only (FR-027).
    if (!row || !request.workspaceRole) throw new ApiProblem(404, "not_found");
    return {
      ...row,
      role: request.workspaceRole,
      createdAt: row.createdAt.toISOString(),
      purgeAfter: row.purgeAfter?.toISOString() ?? null,
    };
  }
}
