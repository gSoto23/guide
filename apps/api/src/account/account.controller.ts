import { Body, Controller, Delete, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  emailChangeConfirmSchema,
  emailChangeSchema,
  type AccountDeletionResponse,
  type EmailChangeBody,
  type EmailChangeConfirmBody,
} from "@guidesk/contracts";
import { RequireStepUp } from "../auth/step-up.guard.js";
import { ApiProblem } from "../common/problem.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { AccountDeletionService } from "./account-deletion.service.js";
import { EmailChangeService } from "./email-change.service.js";
import { ExportService } from "./export.service.js";

function authOf(request: FastifyRequest) {
  if (!request.auth) throw new ApiProblem(401, "unauthenticated");
  return request.auth;
}

/** Personal data: export, deletion, and email change (FR-028, FR-029, T095–T097). */
@Controller("v1/me")
export class AccountController {
  constructor(
    private readonly exporter: ExportService,
    private readonly deletion: AccountDeletionService,
    private readonly emailChange: EmailChangeService,
  ) {}

  @Get("export")
  @RequireStepUp()
  async export(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const data = await this.exporter.build(authOf(request).user.id);
    const day = data.exportedAt.slice(0, 10);
    reply.header("content-disposition", `attachment; filename="guidesk-export-${day}.json"`);
    return data;
  }

  @Delete()
  @HttpCode(202)
  @RequireStepUp({ secondFactor: true })
  remove(@Req() request: FastifyRequest): Promise<AccountDeletionResponse> {
    return this.deletion.schedule(authOf(request).user.id);
  }

  @Post("email-change")
  @HttpCode(202)
  @RequireStepUp({ secondFactor: true })
  requestEmailChange(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(emailChangeSchema)) body: EmailChangeBody,
  ) {
    return this.emailChange.request(authOf(request), body.newEmail);
  }

  @Post("email-change/confirm")
  @HttpCode(200)
  confirmEmailChange(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(emailChangeConfirmSchema)) body: EmailChangeConfirmBody,
  ) {
    return this.emailChange.confirm(authOf(request), body.code);
  }
}
