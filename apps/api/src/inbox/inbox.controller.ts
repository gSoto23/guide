import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  copilotRequestSchema,
  dismissSuggestionSchema,
  inboxQuerySchema,
  takeoverSchema,
  type ConversationDetail,
  type CopilotDraft,
  type CopilotRequest,
  type InboxPage,
  type InboxQuery,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { ConversationsService } from "../conversations/conversations.service.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { InboxService } from "./inbox.service.js";

const HANDLE = { capability: "conversations.handle" } as const;

/** /api/v1/workspaces/{ws}/inbox (feature 006 contracts/http-api.md). */
@Controller("v1/workspaces/:workspaceId/inbox")
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @WorkspaceAction()
  list(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(inboxQuerySchema)) query: InboxQuery,
  ): Promise<InboxPage> {
    return this.inbox.inbox(callerOf(request), workspaceId, query);
  }

  @Post("suggestions/dismiss")
  @HttpCode(204)
  @WorkspaceAction(HANDLE)
  async dismiss(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(dismissSuggestionSchema))
    body: { propertyId: string; topic: string },
  ): Promise<void> {
    await this.inbox.dismissSuggestion(callerOf(request), workspaceId, body.propertyId, body.topic);
  }
}

/** Conversation actions (feature 006 US2, US5) on spec 005's conversation routes. */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/conversations/:conversationId")
export class ConversationActionsController {
  constructor(
    private readonly inbox: InboxService,
    private readonly conversations: ConversationsService,
  ) {}

  private ids(propertyId: string, conversationId: string) {
    assertUuid(propertyId);
    assertUuid(conversationId);
  }

  @Post("done")
  @HttpCode(204)
  @WorkspaceAction(HANDLE)
  async done(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("conversationId") conversationId: string,
  ): Promise<void> {
    this.ids(propertyId, conversationId);
    await this.inbox.markDone(callerOf(request), workspaceId, propertyId, conversationId);
  }

  @Post("reopen")
  @HttpCode(204)
  @WorkspaceAction(HANDLE)
  async reopen(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("conversationId") conversationId: string,
  ): Promise<void> {
    this.ids(propertyId, conversationId);
    await this.inbox.reopen(callerOf(request), workspaceId, propertyId, conversationId);
  }

  @Post("drafts/:draftId/reject")
  @HttpCode(204)
  @WorkspaceAction(HANDLE)
  async reject(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("conversationId") conversationId: string,
    @Param("draftId") draftId: string,
  ): Promise<void> {
    this.ids(propertyId, conversationId);
    assertUuid(draftId);
    await this.inbox.rejectDraft(
      callerOf(request),
      workspaceId,
      propertyId,
      conversationId,
      draftId,
    );
  }

  @Put("takeover")
  @WorkspaceAction(HANDLE)
  async takeover(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(takeoverSchema)) body: { on: boolean },
  ): Promise<ConversationDetail> {
    this.ids(propertyId, conversationId);
    const caller = callerOf(request);
    await this.inbox.takeover(caller, workspaceId, propertyId, conversationId, body.on);
    return this.conversations.detail(caller, workspaceId, propertyId, conversationId);
  }

  @Post("presence")
  @HttpCode(204)
  @WorkspaceAction(HANDLE)
  async presence(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("conversationId") conversationId: string,
  ): Promise<void> {
    this.ids(propertyId, conversationId);
    await this.inbox.presence(callerOf(request), workspaceId, propertyId, conversationId);
  }
}

/** /api/v1/workspaces/{ws}/properties/{pid}/copilot (feature 006 US3). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/copilot")
export class CopilotController {
  constructor(private readonly inbox: InboxService) {}

  @Post()
  @HttpCode(202)
  @WorkspaceAction(HANDLE)
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(copilotRequestSchema)) body: CopilotRequest,
  ): Promise<{ id: string }> {
    assertUuid(propertyId);
    return this.inbox.createCopilot(callerOf(request), workspaceId, propertyId, body);
  }

  @Get(":runId")
  @WorkspaceAction()
  get(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("runId") runId: string,
  ): Promise<CopilotDraft> {
    assertUuid(propertyId);
    assertUuid(runId);
    return this.inbox.getCopilot(workspaceId, propertyId, runId);
  }
}
