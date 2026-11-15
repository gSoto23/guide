import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  stepUpChallengeSchema,
  stepUpVerifySchema,
  type StepUpVerifyBody,
} from "@guidesk/contracts";
import { StepUpService } from "../auth/step-up.service.js";
import { ApiProblem } from "../common/problem.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";

/** POST /api/v1/me/step-up/{challenge,verify} (contracts/http-api.md, T056). */
@Controller("v1/me/step-up")
export class StepUpController {
  constructor(private readonly stepUp: StepUpService) {}

  @Post("challenge")
  @HttpCode(202)
  challenge(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(stepUpChallengeSchema)) _body: unknown,
  ) {
    if (!request.auth) throw new ApiProblem(401, "unauthenticated");
    return this.stepUp.challenge(request.auth);
  }

  @Post("verify")
  @HttpCode(200)
  verify(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(stepUpVerifySchema)) body: StepUpVerifyBody,
  ) {
    if (!request.auth) throw new ApiProblem(401, "unauthenticated");
    return this.stepUp.verify(request.auth, body.code);
  }
}
