import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createBlockItemSchema,
  createSharedBlockSchema,
  revisionBodySchema,
  updateBlockItemSchema,
  updateSharedBlockSchema,
  type CreateBlockItemBody,
  type CreateSharedBlockBody,
  type RevisionBody,
  type SharedBlockList,
  type SharedBlockProperties,
  type SharedBlockPublishResult,
  type SharedBlockView,
  type UpdateBlockItemBody,
  type UpdateSharedBlockBody,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { SharedBlocksService } from "./shared-blocks.service.js";

const MANAGE = { capability: "properties.manage" } as const;

/** /api/v1/workspaces/{workspaceId}/shared-blocks (feature 003 US7, contract "Shared content"). */
@Controller("v1/workspaces/:workspaceId/shared-blocks")
export class SharedBlocksController {
  constructor(private readonly blocks: SharedBlocksService) {}

  @Get()
  @WorkspaceAction()
  list(@Param("workspaceId") workspaceId: string): Promise<SharedBlockList> {
    return this.blocks.list(workspaceId);
  }

  @Post()
  @WorkspaceAction(MANAGE)
  @Idempotent()
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createSharedBlockSchema)) body: CreateSharedBlockBody,
  ): Promise<SharedBlockView> {
    return this.blocks.create(callerOf(request), workspaceId, body);
  }

  @Patch("items/:itemId")
  @WorkspaceAction(MANAGE)
  updateItem(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(updateBlockItemSchema)) body: UpdateBlockItemBody,
  ): Promise<SharedBlockView> {
    assertUuid(itemId);
    return this.blocks.updateItem(callerOf(request), workspaceId, itemId, body);
  }

  @Delete("items/:itemId")
  @WorkspaceAction(MANAGE)
  deleteItem(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(revisionBodySchema)) body: RevisionBody,
  ): Promise<SharedBlockView> {
    assertUuid(itemId);
    return this.blocks.deleteItem(callerOf(request), workspaceId, itemId, body.revision);
  }

  @Post("items/:itemId/approve")
  @WorkspaceAction(MANAGE)
  @HttpCode(200)
  approveItem(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(revisionBodySchema)) body: RevisionBody,
  ): Promise<SharedBlockView> {
    assertUuid(itemId);
    return this.blocks.approveItem(callerOf(request), workspaceId, itemId, body.revision);
  }

  @Get(":blockId")
  @WorkspaceAction()
  get(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string,
  ): Promise<SharedBlockView> {
    assertUuid(blockId);
    return this.blocks.get(callerOf(request), workspaceId, blockId);
  }

  @Patch(":blockId")
  @WorkspaceAction(MANAGE)
  update(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string,
    @Body(new ZodValidationPipe(updateSharedBlockSchema)) body: UpdateSharedBlockBody,
  ): Promise<SharedBlockView> {
    assertUuid(blockId);
    return this.blocks.update(callerOf(request), workspaceId, blockId, body);
  }

  @Post(":blockId/items")
  @WorkspaceAction(MANAGE)
  @Idempotent()
  createItem(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string,
    @Body(new ZodValidationPipe(createBlockItemSchema)) body: CreateBlockItemBody,
  ): Promise<SharedBlockView> {
    assertUuid(blockId);
    return this.blocks.createItem(callerOf(request), workspaceId, blockId, body);
  }

  @Post(":blockId/publish")
  @WorkspaceAction(MANAGE)
  @HttpCode(200)
  publish(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string,
  ): Promise<SharedBlockPublishResult> {
    assertUuid(blockId);
    return this.blocks.publish(callerOf(request), workspaceId, blockId);
  }

  @Delete(":blockId")
  @WorkspaceAction(MANAGE)
  @HttpCode(204)
  async remove(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string,
  ): Promise<void> {
    assertUuid(blockId);
    await this.blocks.remove(callerOf(request), workspaceId, blockId);
  }

  @Get(":blockId/properties")
  @WorkspaceAction(MANAGE)
  properties(
    @Param("workspaceId") workspaceId: string,
    @Param("blockId") blockId: string,
  ): Promise<SharedBlockProperties> {
    assertUuid(blockId);
    return this.blocks.properties(workspaceId, blockId);
  }
}
