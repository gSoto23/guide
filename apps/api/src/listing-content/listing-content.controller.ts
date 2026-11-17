import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  listingContentKindSchema,
  updateListingContentSchema,
  type ListingContentItem,
  type ListingContentKind,
  type ListingContentList,
  type UpdateListingContentBody,
} from "@guidesk/contracts";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { ListingContentService } from "./listing-content.service.js";

const kindPipe = new ZodValidationPipe(listingContentKindSchema);

/** /api/v1/workspaces/{workspaceId}/properties/{propertyId}/listing-content (T028). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/listing-content")
export class ListingContentController {
  constructor(private readonly content: ListingContentService) {}

  @Get()
  @WorkspaceAction()
  list(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<ListingContentList> {
    return this.content.list(callerOf(request), workspaceId, propertyId);
  }

  @Put(":kind")
  @WorkspaceAction({ capability: "properties.manage" })
  edit(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("kind", kindPipe) kind: ListingContentKind,
    @Body(new ZodValidationPipe(updateListingContentSchema)) body: UpdateListingContentBody,
  ): Promise<ListingContentItem> {
    return this.content.edit(callerOf(request), workspaceId, propertyId, kind, body);
  }

  @Post(":kind/approve")
  @HttpCode(200)
  @WorkspaceAction({ capability: "properties.manage" })
  approve(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("kind", kindPipe) kind: ListingContentKind,
  ): Promise<ListingContentItem> {
    return this.content.approve(callerOf(request), workspaceId, propertyId, kind);
  }
}
