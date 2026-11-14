import { Body, Controller, Get, Patch, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  onboardingBodySchema,
  updateMeSchema,
  type MeResponse,
  type OnboardingBody,
  type OnboardingResponse,
  type UpdateMeBody,
} from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { toWebHeaders } from "../common/request.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { MeService } from "./me.service.js";
import { OnboardingService } from "./onboarding.service.js";

function authOf(request: FastifyRequest) {
  if (!request.auth) throw new ApiProblem(401, "unauthenticated");
  return request.auth;
}

/** /api/v1/me (contracts/http-api.md, T041, T042). */
@Controller("v1/me")
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly onboarding: OnboardingService,
  ) {}

  @Get()
  getMe(@Req() request: FastifyRequest): Promise<MeResponse> {
    return this.me.getMe(authOf(request).user);
  }

  @Patch()
  updateMe(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(updateMeSchema)) body: UpdateMeBody,
  ): Promise<MeResponse> {
    return this.me.updateMe(toWebHeaders(request.headers), authOf(request).user, body);
  }

  @Get("onboarding")
  getOnboarding(@Req() request: FastifyRequest): Promise<OnboardingResponse> {
    return this.onboarding.get(authOf(request).user.id);
  }

  @Put("onboarding")
  putOnboarding(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(onboardingBodySchema)) body: OnboardingBody,
  ): Promise<OnboardingResponse> {
    return this.onboarding.put(authOf(request).user.id, body);
  }
}
