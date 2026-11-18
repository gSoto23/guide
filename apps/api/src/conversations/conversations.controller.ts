import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  chatReplySchema,
  propertyAssistantSchema,
  sendDraftSchema,
  workspaceAssistantSchema,
  type ChatReplyBody,
  type ConversationDetail,
  type ConversationSummary,
  type MemberChatMessage,
  type PropertyAssistantSettings,
  type SendDraftBody,
  type WorkspaceAssistantSettings,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { AssistantSettingsService } from "./assistant-settings.service.js";
import { ConversationsService } from "./conversations.service.js";

const HANDLE = { capability: "conversations.handle" } as const;

/** /api/v1/workspaces/{ws}/properties/{pid}/conversations (feature 005 contracts/http-api.md). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId")
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly settings: AssistantSettingsService,
  ) {}

  @Get("conversations")
  @WorkspaceAction()
  list(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<ConversationSummary[]> {
    assertUuid(propertyId);
    return this.conversations.list(workspaceId, propertyId);
  }

  @Get("conversations/:conversationId")
  @WorkspaceAction()
  detail(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("conversationId") conversationId: string,
  ): Promise<ConversationDetail> {
    assertUuid(propertyId);
    assertUuid(conversationId);
    return this.conversations.detail(callerOf(request), workspaceId, propertyId, conversationId);
  }

  @Post("conversations/:conversationId/drafts/:draftId/send")
  @HttpCode(201)
  @WorkspaceAction(HANDLE)
  sendDraft(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("conversationId") conversationId: string,
    @Param("draftId") draftId: string,
    @Body(new ZodValidationPipe(sendDraftSchema)) body: SendDraftBody,
  ): Promise<MemberChatMessage> {
    assertUuid(propertyId);
    assertUuid(conversationId);
    assertUuid(draftId);
    return this.conversations.sendDraft(
      callerOf(request),
      workspaceId,
      propertyId,
      conversationId,
      draftId,
      body,
    );
  }

  @Post("conversations/:conversationId/replies")
  @HttpCode(201)
  @WorkspaceAction(HANDLE)
  reply(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(chatReplySchema)) body: ChatReplyBody,
  ): Promise<MemberChatMessage> {
    assertUuid(propertyId);
    assertUuid(conversationId);
    return this.conversations.reply(
      callerOf(request),
      workspaceId,
      propertyId,
      conversationId,
      body,
    );
  }

  @Get("assistant-settings")
  @WorkspaceAction()
  propertySettings(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<PropertyAssistantSettings> {
    assertUuid(propertyId);
    return this.settings.getProperty(workspaceId, propertyId);
  }

  @Put("assistant-settings")
  @WorkspaceAction({ capability: "properties.manage" })
  setPropertySettings(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(propertyAssistantSchema))
    body: { override: "draft" | "auto" | null },
  ): Promise<PropertyAssistantSettings> {
    assertUuid(propertyId);
    return this.settings.setProperty(
      callerOf(request).userId,
      workspaceId,
      propertyId,
      body.override,
    );
  }
}

/** /api/v1/workspaces/{ws}/assistant-settings: the workspace default (FR-022). */
@Controller("v1/workspaces/:workspaceId/assistant-settings")
export class AssistantSettingsController {
  constructor(private readonly settings: AssistantSettingsService) {}

  @Get()
  @WorkspaceAction()
  get(@Param("workspaceId") workspaceId: string): Promise<WorkspaceAssistantSettings> {
    return this.settings.getWorkspace(workspaceId);
  }

  @Put()
  @WorkspaceAction({ capability: "workspace.settings" })
  set(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(workspaceAssistantSchema)) body: { autonomy: "draft" | "auto" },
  ): Promise<WorkspaceAssistantSettings> {
    return this.settings.setWorkspace(callerOf(request).userId, workspaceId, body.autonomy);
  }
}
