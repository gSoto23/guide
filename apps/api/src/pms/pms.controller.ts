import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createPmsConnectionSchema,
  startPmsImportSchema,
  type CreatedPmsConnection,
  type CreatePmsConnectionBody,
  type ImportRun,
  type PmsConnectionList,
  type PmsDisconnectResult,
  type PmsListingList,
  type StartPmsImportBody,
} from "@guidesk/contracts";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { PmsService } from "./pms.service.js";

/** Owners and admins only; agents get 404, so a connection's existence is not revealed. */
const CONNECTION_ACCESS = { capability: "properties.manage", deniedAs: "not_found" } as const;

/** PMS connection routes (feature 002 contracts/http-api.md, T093). */
@Controller("v1/workspaces/:workspaceId/pms-connections")
export class PmsController {
  constructor(private readonly pms: PmsService) {}

  @Get()
  @WorkspaceAction(CONNECTION_ACCESS)
  list(@Param("workspaceId") workspaceId: string): Promise<PmsConnectionList> {
    return this.pms.list(workspaceId);
  }

  /** Connecting needs a recent sign-in and, above the threshold, a second factor (FR-027). */
  @Post()
  @HttpCode(201)
  @WorkspaceAction({ ...CONNECTION_ACCESS, stepUp: true, mfa: true })
  connect(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createPmsConnectionSchema)) body: CreatePmsConnectionBody,
  ): Promise<CreatedPmsConnection> {
    return this.pms.connect(callerOf(request), workspaceId, body);
  }

  @Get(":connectionId/listings")
  @WorkspaceAction(CONNECTION_ACCESS)
  listings(
    @Param("workspaceId") workspaceId: string,
    @Param("connectionId") connectionId: string,
  ): Promise<PmsListingList> {
    return this.pms.listings(workspaceId, connectionId);
  }

  @Post(":connectionId/imports")
  @HttpCode(202)
  @Idempotent()
  @WorkspaceAction(CONNECTION_ACCESS)
  startImport(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("connectionId") connectionId: string,
    @Body(new ZodValidationPipe(startPmsImportSchema)) body: StartPmsImportBody,
  ): Promise<ImportRun> {
    return this.pms.startImport(callerOf(request), workspaceId, connectionId, body.externalIds);
  }

  @Post(":connectionId/refresh")
  @HttpCode(202)
  @WorkspaceAction(CONNECTION_ACCESS)
  async refresh(
    @Param("workspaceId") workspaceId: string,
    @Param("connectionId") connectionId: string,
  ): Promise<void> {
    await this.pms.refreshNow(workspaceId, connectionId);
  }

  @Delete(":connectionId")
  @HttpCode(200)
  @WorkspaceAction(CONNECTION_ACCESS)
  disconnect(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("connectionId") connectionId: string,
  ): Promise<PmsDisconnectResult> {
    return this.pms.disconnect(callerOf(request), workspaceId, connectionId);
  }
}
