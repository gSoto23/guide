import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import {
  previewQuerySchema,
  publishSchema,
  type GuidePreview,
  type GuideVersionList,
  type PreviewQuery,
  type PublishBody,
  type PublishCheck,
  type PublishResult,
  createItemSchema,
  createSectionSchema,
  orderItemsSchema,
  orderSectionsSchema,
  revisionBodySchema,
  topicMarkSchema,
  updateItemSchema,
  updateSectionSchema,
  type CreateItemBody,
  type CreateSectionBody,
  type GuideView,
  type OrderItemsBody,
  type OrderSectionsBody,
  type RevisionBody,
  type SectionWriteResult,
  type TopicMarkBody,
  type UpdateItemBody,
  type UpdateSectionBody,
} from "@guidesk/contracts";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { GuidesService } from "./guides.service.js";
import { PublishService } from "./publish.service.js";

const MANAGE = { capability: "properties.manage" } as const;
const versionNumberSchema = z.string().regex(/^[1-9]\d{0,5}$/);

/** /api/v1/workspaces/{workspaceId}/properties/{propertyId}/guide (feature 003 contract). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/guide")
export class GuidesController {
  constructor(
    private readonly guides: GuidesService,
    private readonly publishing: PublishService,
  ) {}

  @Get("preview")
  @WorkspaceAction()
  preview(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Query(new ZodValidationPipe(previewQuerySchema)) query: PreviewQuery,
  ): Promise<GuidePreview> {
    return this.publishing.preview(workspaceId, propertyId, query);
  }

  @Get("publish-check")
  @WorkspaceAction(MANAGE)
  publishCheck(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<PublishCheck> {
    return this.publishing.check(workspaceId, propertyId);
  }

  @Post("publish")
  @WorkspaceAction(MANAGE)
  @Idempotent()
  publish(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(publishSchema)) body: PublishBody,
  ): Promise<PublishResult> {
    return this.publishing.publish(callerOf(request), workspaceId, propertyId, body);
  }

  @Post("unpublish")
  @WorkspaceAction(MANAGE)
  @HttpCode(204)
  async unpublish(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<void> {
    await this.publishing.unpublish(callerOf(request), workspaceId, propertyId);
  }

  @Get("versions")
  @WorkspaceAction()
  versions(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<GuideVersionList> {
    return this.publishing.versions(workspaceId, propertyId);
  }

  @Get("versions/:number")
  @WorkspaceAction()
  version(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("number", new ZodValidationPipe(versionNumberSchema)) number: string,
    @Query(new ZodValidationPipe(previewQuerySchema.pick({ lang: true })))
    query: { lang?: "es" | "en" },
  ): Promise<GuidePreview> {
    return this.publishing.preview(workspaceId, propertyId, { source: number, ...query });
  }

  @Post("versions/:number/restore")
  @WorkspaceAction(MANAGE)
  @HttpCode(200)
  restore(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("number", new ZodValidationPipe(versionNumberSchema)) number: string,
  ): Promise<GuideView> {
    return this.publishing.restore(callerOf(request), workspaceId, propertyId, Number(number));
  }

  @Get()
  @WorkspaceAction()
  get(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<GuideView> {
    return this.guides.get(callerOf(request), workspaceId, propertyId);
  }

  @Post("sections")
  @WorkspaceAction(MANAGE)
  @Idempotent()
  createSection(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(createSectionSchema)) body: CreateSectionBody,
  ): Promise<SectionWriteResult> {
    return this.guides.createSection(callerOf(request), workspaceId, propertyId, body);
  }

  @Put("sections/order")
  @WorkspaceAction(MANAGE)
  orderSections(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(orderSectionsSchema)) body: OrderSectionsBody,
  ): Promise<GuideView> {
    return this.guides.orderSections(callerOf(request), workspaceId, propertyId, body);
  }

  @Patch("sections/:sectionId")
  @WorkspaceAction(MANAGE)
  updateSection(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sectionId") sectionId: string,
    @Body(new ZodValidationPipe(updateSectionSchema)) body: UpdateSectionBody,
  ): Promise<SectionWriteResult> {
    return this.guides.updateSection(callerOf(request), workspaceId, propertyId, sectionId, body);
  }

  @Delete("sections/:sectionId")
  @WorkspaceAction(MANAGE)
  deleteSection(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sectionId") sectionId: string,
  ): Promise<GuideView> {
    return this.guides.deleteSection(callerOf(request), workspaceId, propertyId, sectionId);
  }

  @Post("sections/:sectionId/approve")
  @HttpCode(200)
  @WorkspaceAction(MANAGE)
  approveSection(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sectionId") sectionId: string,
    @Body(new ZodValidationPipe(revisionBodySchema)) body: RevisionBody,
  ): Promise<SectionWriteResult> {
    return this.guides.approveSection(
      callerOf(request),
      workspaceId,
      propertyId,
      sectionId,
      body.revision,
    );
  }

  @Post("sections/:sectionId/redraft")
  @HttpCode(202)
  @WorkspaceAction(MANAGE)
  async redraftSection(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sectionId") sectionId: string,
  ): Promise<{ queued: true }> {
    await this.guides.redraftSection(workspaceId, propertyId, sectionId);
    return { queued: true };
  }

  @Post("sections/:sectionId/items")
  @WorkspaceAction(MANAGE)
  @Idempotent()
  createItem(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sectionId") sectionId: string,
    @Body(new ZodValidationPipe(createItemSchema)) body: CreateItemBody,
  ): Promise<SectionWriteResult> {
    return this.guides.createItem(callerOf(request), workspaceId, propertyId, sectionId, body);
  }

  @Put("sections/:sectionId/items/order")
  @WorkspaceAction(MANAGE)
  orderItems(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sectionId") sectionId: string,
    @Body(new ZodValidationPipe(orderItemsSchema)) body: OrderItemsBody,
  ): Promise<SectionWriteResult> {
    return this.guides.orderItems(callerOf(request), workspaceId, propertyId, sectionId, body);
  }

  @Patch("items/:itemId")
  @WorkspaceAction(MANAGE)
  updateItem(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(updateItemSchema)) body: UpdateItemBody,
  ): Promise<SectionWriteResult> {
    return this.guides.updateItem(callerOf(request), workspaceId, propertyId, itemId, body);
  }

  @Delete("items/:itemId")
  @WorkspaceAction(MANAGE)
  deleteItem(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(revisionBodySchema)) body: RevisionBody,
  ): Promise<SectionWriteResult> {
    return this.guides.deleteItem(
      callerOf(request),
      workspaceId,
      propertyId,
      itemId,
      body.revision,
    );
  }

  @Post("items/:itemId/approve")
  @HttpCode(200)
  @WorkspaceAction(MANAGE)
  approveItem(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(revisionBodySchema)) body: RevisionBody,
  ): Promise<SectionWriteResult> {
    return this.guides.approveItem(
      callerOf(request),
      workspaceId,
      propertyId,
      itemId,
      body.revision,
    );
  }

  @Put("topics/:topicId")
  @WorkspaceAction(MANAGE)
  markTopic(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("topicId") topicId: string,
    @Body(new ZodValidationPipe(topicMarkSchema)) body: TopicMarkBody,
  ): Promise<GuideView> {
    return this.guides.markTopic(callerOf(request), workspaceId, propertyId, topicId, body);
  }
}
