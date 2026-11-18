import { Body, Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  interviewAnswerSchema,
  interviewTopicSchema,
  interviewVoiceSchema,
  startInterviewSchema,
  type InterviewAnswerBody,
  type InterviewTopicBody,
  type InterviewTurnView,
  type InterviewView,
  type InterviewVoiceBody,
  type StartInterviewBody,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import type { UploadForm } from "../uploads/uploads.service.js";
import { InterviewsService } from "./interviews.service.js";

const MANAGE = { capability: "properties.manage" } as const;

/** /api/v1/workspaces/{workspaceId}/properties/{propertyId}/guide/interview (feature 003 US4). */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/guide/interview")
export class InterviewsController {
  constructor(private readonly interviews: InterviewsService) {}

  @Post()
  @WorkspaceAction(MANAGE)
  @HttpCode(200)
  start(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(startInterviewSchema)) body: StartInterviewBody,
  ): Promise<InterviewView> {
    return this.interviews.start(callerOf(request), workspaceId, propertyId, body);
  }

  @Get(":sessionId")
  @WorkspaceAction()
  get(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sessionId") sessionId: string,
  ): Promise<InterviewView> {
    assertUuid(sessionId);
    return this.interviews.get(workspaceId, propertyId, sessionId);
  }

  @Post(":sessionId/voice")
  @WorkspaceAction(MANAGE)
  voice(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sessionId") sessionId: string,
    @Body(new ZodValidationPipe(interviewVoiceSchema)) body: InterviewVoiceBody,
  ): Promise<UploadForm> {
    assertUuid(sessionId);
    return this.interviews.voiceUpload(callerOf(request), workspaceId, propertyId, sessionId, body);
  }

  @Post(":sessionId/answers")
  @WorkspaceAction(MANAGE)
  @HttpCode(202)
  answer(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sessionId") sessionId: string,
    @Body(new ZodValidationPipe(interviewAnswerSchema)) body: InterviewAnswerBody,
  ): Promise<InterviewTurnView> {
    assertUuid(sessionId);
    return this.interviews.answer(callerOf(request), workspaceId, propertyId, sessionId, body);
  }

  @Get(":sessionId/turns/:turnId")
  @WorkspaceAction(MANAGE)
  turn(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sessionId") sessionId: string,
    @Param("turnId") turnId: string,
  ): Promise<InterviewTurnView> {
    assertUuid(sessionId);
    assertUuid(turnId);
    return this.interviews.turn(workspaceId, propertyId, sessionId, turnId);
  }

  @Post(":sessionId/skip")
  @WorkspaceAction(MANAGE)
  @HttpCode(200)
  skip(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sessionId") sessionId: string,
    @Body(new ZodValidationPipe(interviewTopicSchema)) body: InterviewTopicBody,
  ): Promise<InterviewView> {
    assertUuid(sessionId);
    return this.interviews.skip(workspaceId, propertyId, sessionId, body.topicId);
  }

  @Post(":sessionId/finish")
  @WorkspaceAction(MANAGE)
  @HttpCode(200)
  finish(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("sessionId") sessionId: string,
  ): Promise<InterviewView> {
    assertUuid(sessionId);
    return this.interviews.finish(workspaceId, propertyId, sessionId);
  }
}
