import { Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import {
  listImportItemsQuerySchema,
  listImportRunsQuerySchema,
  type ImportItemList,
  type ImportRun,
  type ImportRunList,
} from "@guidesk/contracts";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { ImportRunsService } from "./import-runs.service.js";

/** Import runs, PMS and CSV (feature 002 contracts/http-api.md, T094). Owners and admins. */
@Controller("v1/workspaces/:workspaceId/imports")
export class ImportRunsController {
  constructor(private readonly runs: ImportRunsService) {}

  @Get()
  @WorkspaceAction({ capability: "properties.manage" })
  list(
    @Param("workspaceId") workspaceId: string,
    @Query(new ZodValidationPipe(listImportRunsQuerySchema))
    query: { status?: ImportRun["status"] },
  ): Promise<ImportRunList> {
    return this.runs.list(workspaceId, query.status);
  }

  @Get(":importRunId")
  @WorkspaceAction({ capability: "properties.manage" })
  get(
    @Param("workspaceId") workspaceId: string,
    @Param("importRunId") importRunId: string,
  ): Promise<ImportRun> {
    return this.runs.get(workspaceId, importRunId);
  }

  @Get(":importRunId/items")
  @WorkspaceAction({ capability: "properties.manage" })
  items(
    @Param("workspaceId") workspaceId: string,
    @Param("importRunId") importRunId: string,
    @Query(new ZodValidationPipe(listImportItemsQuerySchema))
    query: { outcome?: ImportItemList["items"][number]["outcome"] },
  ): Promise<ImportItemList> {
    return this.runs.items(workspaceId, importRunId, query.outcome);
  }

  @Post(":importRunId/items/:itemId/retry")
  @HttpCode(202)
  @WorkspaceAction({ capability: "properties.manage" })
  retry(
    @Param("workspaceId") workspaceId: string,
    @Param("importRunId") importRunId: string,
    @Param("itemId") itemId: string,
  ): Promise<ImportRun> {
    return this.runs.retryItem(workspaceId, importRunId, itemId);
  }
}
