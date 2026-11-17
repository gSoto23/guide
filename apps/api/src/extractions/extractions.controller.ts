import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createExtractionSchema,
  type CreateExtractionBody,
  type CreatedExtraction,
  type Extraction,
} from "@guidesk/contracts";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { ExtractionsService } from "./extractions.service.js";

/** /api/v1/workspaces/{workspaceId}/extractions (feature 002 contracts/http-api.md, T058). */
@Controller("v1/workspaces/:workspaceId/extractions")
export class ExtractionsController {
  constructor(private readonly extractions: ExtractionsService) {}

  @Post()
  @HttpCode(201)
  @Idempotent()
  @WorkspaceAction({ capability: "properties.manage" })
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createExtractionSchema)) body: CreateExtractionBody,
  ): Promise<CreatedExtraction> {
    return this.extractions.create(callerOf(request), workspaceId, body);
  }

  @Post(":extractionId/submit")
  @HttpCode(202)
  @WorkspaceAction({ capability: "properties.manage" })
  async submit(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("extractionId") extractionId: string,
  ): Promise<void> {
    await this.extractions.submit(callerOf(request), workspaceId, extractionId);
  }

  @Get(":extractionId")
  @WorkspaceAction({ capability: "properties.manage" })
  get(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("extractionId") extractionId: string,
  ): Promise<Extraction> {
    return this.extractions.get(callerOf(request), workspaceId, extractionId);
  }

  @Post(":extractionId/retry")
  @HttpCode(202)
  @WorkspaceAction({ capability: "properties.manage" })
  retry(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("extractionId") extractionId: string,
  ): Promise<{ extractionId: string }> {
    return this.extractions.retry(callerOf(request), workspaceId, extractionId);
  }
}
