import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  assistantTestSchema,
  propertyAssistantInputSchema,
  workspaceAssistantInputSchema,
  type AssistantTest,
  type AssistantTestBody,
  type PropertyAssistant,
  type PropertyAssistantInput,
  type WorkspaceAssistant,
  type WorkspaceAssistantInput,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { AssistantService } from "./assistant.service.js";

/** /api/v1/workspaces/{ws}/assistant: the workspace's defaults (feature 007 contracts). */
@Controller("v1/workspaces/:workspaceId/assistant")
export class WorkspaceAssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get()
  @WorkspaceAction()
  get(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
  ): Promise<WorkspaceAssistant> {
    return this.assistant.getWorkspace(callerOf(request), workspaceId);
  }

  @Put()
  @WorkspaceAction({ capability: "workspace.settings" })
  set(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(workspaceAssistantInputSchema)) body: WorkspaceAssistantInput,
  ): Promise<WorkspaceAssistant> {
    return this.assistant.setWorkspace(callerOf(request), workspaceId, body);
  }
}

/** /api/v1/workspaces/{ws}/properties/{pid}/assistant: a property's own values and tests. */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/assistant")
export class PropertyAssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get()
  @WorkspaceAction()
  get(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
  ): Promise<PropertyAssistant> {
    assertUuid(propertyId);
    return this.assistant.getProperty(callerOf(request), workspaceId, propertyId);
  }

  @Put()
  @WorkspaceAction({ capability: "properties.manage" })
  set(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(propertyAssistantInputSchema)) body: PropertyAssistantInput,
  ): Promise<PropertyAssistant> {
    assertUuid(propertyId);
    return this.assistant.setProperty(callerOf(request), workspaceId, propertyId, body);
  }

  @Post("tests")
  @HttpCode(202)
  @WorkspaceAction({ capability: "conversations.handle" })
  test(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Body(new ZodValidationPipe(assistantTestSchema)) body: AssistantTestBody,
  ): Promise<{ id: string }> {
    assertUuid(propertyId);
    return this.assistant.createTest(callerOf(request), workspaceId, propertyId, body);
  }

  @Get("tests/:testId")
  @WorkspaceAction()
  result(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Param("testId") testId: string,
  ): Promise<AssistantTest> {
    assertUuid(propertyId);
    assertUuid(testId);
    return this.assistant.getTest(workspaceId, propertyId, testId);
  }
}
