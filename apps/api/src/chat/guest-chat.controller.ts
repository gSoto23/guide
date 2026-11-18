import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import {
  guestChatQuerySchema,
  postChatMessageSchema,
  type GuestChat,
  type PostChatMessageBody,
  type PostChatMessageResponse,
} from "@guidesk/contracts";
import { Public } from "../auth/public.decorator.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { guestIpKey, GuestInterceptor } from "../guest/guest.interceptor.js";
import { GuestChatService } from "./guest-chat.service.js";

/**
 * /api/v1/guest/chat (feature 005 contracts/http-api.md): guide origin only, behind the guest
 * interceptor (per-address limits, noindex). Never cached: every response is about one device.
 */
@Public()
@UseInterceptors(GuestInterceptor)
@Controller("v1/guest/chat")
export class GuestChatController {
  constructor(private readonly chat: GuestChatService) {}

  @Get()
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query(new ZodValidationPipe(guestChatQuerySchema)) query: z.infer<typeof guestChatQuerySchema>,
  ): Promise<GuestChat> {
    void reply.header("cache-control", "no-store");
    return this.chat.chat(query.publicId, query.after, request.headers.cookie);
  }

  @Post("messages")
  @HttpCode(202)
  async post(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodValidationPipe(postChatMessageSchema)) body: PostChatMessageBody,
  ): Promise<PostChatMessageResponse> {
    const result = await this.chat.post(body, request.headers.cookie, guestIpKey(request));
    void reply.header("cache-control", "no-store");
    if (result.setCookie) void reply.header("set-cookie", result.setCookie);
    return result.body;
  }
}
