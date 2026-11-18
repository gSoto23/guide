import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  createLockedFieldSchema,
  lockedFieldVisibilitySchema,
  moveToLockedFieldSchema,
  updateLockedFieldSchema,
  type CreateLockedFieldBody,
  type LockedFieldView,
  type LockedFieldVisibilityBody,
  type MoveToLockedFieldBody,
  type RevealedValue,
  type RevealHistory,
  type SectionWriteResult,
  type UpdateLockedFieldBody,
} from "@guidesk/contracts";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { LockedFieldsService } from "./locked-fields.service.js";

/** Writes need a recent sign-in and, above the threshold, a second factor (FR-017, SEC-05). */
const WRITE = { capability: "properties.manage", stepUp: true, mfa: true } as const;
/** Reveals and the Wi-Fi switch: owners and admins only; agents get 404 (FR-063). */
const REVEAL = {
  capability: "restricted.reveal",
  stepUp: true,
  mfa: true,
  deniedAs: "not_found",
} as const;

/** /api/v1/workspaces/{workspaceId}/properties/{propertyId}/guide/locked-fields (feature 003). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/guide/locked-fields")
export class LockedFieldsController {
  constructor(private readonly fields: LockedFieldsService) {}

  @Get()
  @WorkspaceAction()
  list(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<LockedFieldView[]> {
    return this.fields.list(callerOf(request), workspaceId, propertyId);
  }

  @Get("reveals")
  @WorkspaceAction({ capability: "restricted.reveal", deniedAs: "not_found" })
  history(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<RevealHistory> {
    return this.fields.history(workspaceId, propertyId);
  }

  @Post()
  @WorkspaceAction(WRITE)
  @Idempotent()
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(createLockedFieldSchema)) body: CreateLockedFieldBody,
  ): Promise<LockedFieldView> {
    return this.fields.create(callerOf(request), workspaceId, propertyId, body);
  }

  @Patch(":fieldId")
  @WorkspaceAction(WRITE)
  update(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("fieldId") fieldId: string,
    @Body(new ZodValidationPipe(updateLockedFieldSchema)) body: UpdateLockedFieldBody,
  ): Promise<LockedFieldView> {
    return this.fields.update(callerOf(request), workspaceId, propertyId, fieldId, body);
  }

  @Delete(":fieldId")
  @HttpCode(204)
  @WorkspaceAction(WRITE)
  async remove(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("fieldId") fieldId: string,
    @Query("confirm") confirm?: string,
  ): Promise<void> {
    await this.fields.remove(
      callerOf(request),
      workspaceId,
      propertyId,
      fieldId,
      confirm === "true",
    );
  }

  @Post(":fieldId/reveal")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @WorkspaceAction(REVEAL)
  reveal(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("fieldId") fieldId: string,
  ): Promise<RevealedValue> {
    return this.fields.reveal(callerOf(request), workspaceId, propertyId, fieldId);
  }

  @Put(":fieldId/visibility")
  @WorkspaceAction(REVEAL)
  visibility(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("fieldId") fieldId: string,
    @Body(new ZodValidationPipe(lockedFieldVisibilitySchema)) body: LockedFieldVisibilityBody,
  ): Promise<LockedFieldView> {
    return this.fields.setVisibility(
      callerOf(request),
      workspaceId,
      propertyId,
      fieldId,
      body.public,
    );
  }
}

/** POST …/guide/items/{itemId}/move-to-locked-field (feature 003 contract, FR-023). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/guide/items")
export class MoveToLockedFieldController {
  constructor(private readonly fields: LockedFieldsService) {}

  @Post(":itemId/move-to-locked-field")
  @HttpCode(200)
  @WorkspaceAction(WRITE)
  move(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(moveToLockedFieldSchema)) body: MoveToLockedFieldBody,
  ): Promise<SectionWriteResult> {
    return this.fields.moveFromItem(callerOf(request), workspaceId, propertyId, itemId, body);
  }
}
