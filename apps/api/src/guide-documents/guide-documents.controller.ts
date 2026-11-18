import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createDocumentsSchema,
  type CreateDocumentsBody,
  type DocumentList,
  type DocumentUpload,
  type DocumentView,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { GuideDocumentsService } from "./guide-documents.service.js";

const MANAGE = { capability: "properties.manage" } as const;

/** /api/v1/workspaces/{workspaceId}/properties/{propertyId}/guide/documents (feature 003 US6). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/guide/documents")
export class GuideDocumentsController {
  constructor(private readonly documents: GuideDocumentsService) {}

  @Post()
  @WorkspaceAction(MANAGE)
  @Idempotent()
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(createDocumentsSchema)) body: CreateDocumentsBody,
  ): Promise<DocumentUpload[]> {
    return this.documents.create(callerOf(request), workspaceId, propertyId, body);
  }

  @Post(":documentId/complete")
  @WorkspaceAction(MANAGE)
  @HttpCode(202)
  complete(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("documentId") documentId: string,
  ): Promise<DocumentView> {
    assertUuid(documentId);
    return this.documents.complete(workspaceId, propertyId, documentId);
  }

  @Get()
  @WorkspaceAction()
  list(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<DocumentList> {
    return this.documents.list(workspaceId, propertyId);
  }

  @Delete(":documentId")
  @WorkspaceAction(MANAGE)
  @HttpCode(204)
  async remove(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("documentId") documentId: string,
  ): Promise<void> {
    assertUuid(documentId);
    await this.documents.remove(workspaceId, propertyId, documentId);
  }
}
