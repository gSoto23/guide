import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  pushSubscriptionSchema,
  type PushStatus,
  type PushSubscriptionBody,
} from "@guidesk/contracts";
import { assertUuid } from "../common/ids.js";
import { ApiProblem } from "../common/problem.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { PushService } from "./push.service.js";

function userIdOf(request: FastifyRequest): string {
  if (!request.auth) throw new ApiProblem(401, "unauthenticated");
  return request.auth.user.id;
}

/** /api/v1/me/push (feature 006 contracts/http-api.md, US4). */
@Controller("v1/me/push")
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get()
  status(@Req() request: FastifyRequest): Promise<PushStatus> {
    userIdOf(request);
    return this.push.status();
  }

  @Post("subscriptions")
  @HttpCode(201)
  subscribe(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(pushSubscriptionSchema)) body: PushSubscriptionBody,
  ): Promise<{ id: string }> {
    return this.push.subscribe(userIdOf(request), body);
  }

  @Delete("subscriptions/:id")
  @HttpCode(204)
  async remove(@Req() request: FastifyRequest, @Param("id") id: string): Promise<void> {
    assertUuid(id);
    await this.push.remove(userIdOf(request), id);
  }

  @Post("test")
  @HttpCode(202)
  async test(@Req() request: FastifyRequest): Promise<void> {
    await this.push.test(userIdOf(request));
  }
}
