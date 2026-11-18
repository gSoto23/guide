import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  chatReplySchema,
  sendDraftSchema,
  type ChatReplyBody,
  type ConversationDetail,
  type ConversationSummary,
  type MemberChatMessage,
  type SendDraftBody,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { ConversationsService } from "./conversations.service.js";

const HANDLE = { capability: "conversations.handle" } as const;

/** /api/v1/workspaces/{ws}/properties/{pid}/conversations (feature 005 contracts/http-api.md). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId")
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

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
}
