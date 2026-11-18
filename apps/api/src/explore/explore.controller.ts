import { Body, Controller, Get, Param, Put, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  propertyExploreBodySchema,
  workspaceExploreBodySchema,
  type PropertyExplore,
  type PropertyExploreBody,
  type WorkspaceExplore,
  type WorkspaceExploreBody,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { ExploreService } from "./explore.service.js";

/** Owners and admins, who edit guides, change what guests see (research R10). */
const MANAGE = { capability: "properties.manage" } as const;

const languageOf = (value: unknown): "es" | "en" => (value === "en" ? "en" : "es");

/** /api/v1/workspaces/{ws}/explore: the workspace default (feature 009 contracts). */
@Controller("v1/workspaces/:workspaceId/explore")
export class WorkspaceExploreController {
  constructor(private readonly explore: ExploreService) {}

  @Get()
  @WorkspaceAction()
  get(@Param("workspaceId") workspaceId: string): Promise<WorkspaceExplore> {
    return this.explore.getWorkspace(workspaceId);
  }

  @Put()
  @WorkspaceAction(MANAGE)
  set(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(workspaceExploreBodySchema)) body: WorkspaceExploreBody,
  ): Promise<WorkspaceExplore> {
    return this.explore.setWorkspace(callerOf(request), workspaceId, body);
  }
}

/** /api/v1/workspaces/{ws}/properties/{pid}/explore: a property's settings and what guests see. */
@Controller("v1/workspaces/:workspaceId/properties/:propertyId/explore")
export class PropertyExploreController {
  constructor(private readonly explore: ExploreService) {}

  @Get()
  @WorkspaceAction()
  get(
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Query("lang") lang: unknown,
  ): Promise<PropertyExplore> {
    assertUuid(propertyId);
    return this.explore.getProperty(workspaceId, propertyId, languageOf(lang));
  }

  @Put()
  @WorkspaceAction(MANAGE)
  set(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("propertyId") propertyId: string,
    @Query("lang") lang: unknown,
    @Body(new ZodValidationPipe(propertyExploreBodySchema)) body: PropertyExploreBody,
  ): Promise<PropertyExplore> {
    assertUuid(propertyId);
    return this.explore.setProperty(
      callerOf(request),
      workspaceId,
      propertyId,
      body,
      languageOf(lang),
    );
  }
}
