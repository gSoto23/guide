import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  confirmCsvImportSchema,
  createCsvImportSchema,
  csvLanguageQuerySchema,
  type ConfirmCsvImportBody,
  type CreateCsvImportBody,
  type CreatedCsvImport,
  type ImportRun,
} from "@guidesk/contracts";
import type { CsvLanguage } from "@guidesk/domain";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { callerOf } from "../properties/properties.controller.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";
import { CsvImportsService } from "./csv-imports.service.js";

/** Owners and admins only; agents get 404 (AC-SEC-001). */
const CSV_ACCESS = { capability: "properties.manage", deniedAs: "not_found" } as const;

const FILE_NAMES = {
  template: { es: "guidesk-plantilla.csv", en: "guidesk-template.csv" },
  errors: { es: "guidesk-errores.csv", en: "guidesk-errors.csv" },
} as const;

/** Sends a CSV download that no cache keeps. */
function asCsvDownload(reply: FastifyReply, fileName: string): void {
  reply.header("content-type", "text/csv; charset=utf-8");
  reply.header("content-disposition", `attachment; filename="${fileName}"`);
  reply.header("cache-control", "no-store");
}

/** CSV import routes (feature 002 contracts/http-api.md, US5, T109). */
@Controller("v1/workspaces/:workspaceId/imports")
export class CsvImportsController {
  constructor(private readonly csv: CsvImportsService) {}

  @Get("csv-template")
  @WorkspaceAction(CSV_ACCESS)
  template(
    @Query(new ZodValidationPipe(csvLanguageQuerySchema)) query: { lang: CsvLanguage },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): string {
    asCsvDownload(reply, FILE_NAMES.template[query.lang]);
    return this.csv.template(query.lang);
  }

  @Post("csv")
  @HttpCode(201)
  @Idempotent()
  @WorkspaceAction(CSV_ACCESS)
  create(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(createCsvImportSchema)) body: CreateCsvImportBody,
  ): Promise<CreatedCsvImport> {
    return this.csv.create(callerOf(request), workspaceId, body);
  }

  @Post(":importRunId/validate")
  @HttpCode(202)
  @WorkspaceAction(CSV_ACCESS)
  async validate(
    @Param("workspaceId") workspaceId: string,
    @Param("importRunId") importRunId: string,
  ): Promise<void> {
    await this.csv.validate(workspaceId, importRunId);
  }

  @Post(":importRunId/confirm")
  @HttpCode(202)
  @WorkspaceAction(CSV_ACCESS)
  confirm(
    @Req() request: FastifyRequest,
    @Param("workspaceId") workspaceId: string,
    @Param("importRunId") importRunId: string,
    @Body(new ZodValidationPipe(confirmCsvImportSchema)) body: ConfirmCsvImportBody,
  ): Promise<ImportRun> {
    return this.csv.confirm(callerOf(request), workspaceId, importRunId, body);
  }

  @Post(":importRunId/cancel")
  @HttpCode(200)
  @WorkspaceAction(CSV_ACCESS)
  cancel(
    @Param("workspaceId") workspaceId: string,
    @Param("importRunId") importRunId: string,
  ): Promise<ImportRun> {
    return this.csv.cancel(workspaceId, importRunId);
  }

  @Get(":importRunId/error-file")
  @WorkspaceAction(CSV_ACCESS)
  async errorFile(
    @Param("workspaceId") workspaceId: string,
    @Param("importRunId") importRunId: string,
    @Query(new ZodValidationPipe(csvLanguageQuerySchema)) query: { lang: CsvLanguage },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const file = await this.csv.errorFile(workspaceId, importRunId, query.lang);
    asCsvDownload(reply, FILE_NAMES.errors[query.lang]);
    return file;
  }
}
