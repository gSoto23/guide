import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseInterceptors,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  guestGuideQuerySchema,
  guestRevealSchema,
  guestSessionQuerySchema,
  stayExchangeSchema,
  type GuestGuide,
  type GuestRevealBody,
  type GuestSession,
  type RevealResponse,
  type StayExchangeBody,
  type StayExchangeResponse,
} from "@guidesk/contracts";
import { Public } from "../auth/public.decorator.js";
import { assertUuid } from "../common/ids.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { GuestGuideService, GUEST_MEDIA_VARIANTS } from "./guest-guide.service.js";
import { guestIpKey, GuestInterceptor } from "./guest.interceptor.js";
import { unavailable } from "./guest-context.js";
import { GuestReveals } from "./reveals.service.js";
import { GuestSessions } from "./sessions.service.js";

/**
 * Public guide data (feature 004 R9): cached by the CDN for a minute, served stale for a day if
 * the origin fails. It never carries session state or locked values, so sharing it is safe.
 */
export const PUBLIC_GUIDE_CACHE = "public, max-age=0, s-maxage=60, stale-if-error=86400";

const variantSchema = z.enum(GUEST_MEDIA_VARIANTS);

/** /api/v1/guest (feature 004 contracts/http-api.md): no member session; guide origin only. */
@Public()
@UseInterceptors(GuestInterceptor)
@Controller("v1/guest")
export class GuestController {
  constructor(
    private readonly guides: GuestGuideService,
    private readonly sessions: GuestSessions,
    private readonly reveals: GuestReveals,
  ) {}

  @Get("guides/:publicId")
  async guide(
    @Param("publicId") publicId: string,
    @Query(new ZodValidationPipe(guestGuideQuerySchema))
    query: z.infer<typeof guestGuideQuerySchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<GuestGuide> {
    const result = await this.guides.guide(publicId, query.lang);
    void reply.header("cache-control", PUBLIC_GUIDE_CACHE);
    return result;
  }

  @Get("media/:publicId/:mediaId/:variant")
  async media(
    @Param("publicId") publicId: string,
    @Param("mediaId") mediaId: string,
    @Param("variant") variant: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const parsed = variantSchema.safeParse(variant);
    if (!parsed.success) throw unavailable();
    try {
      assertUuid(mediaId);
    } catch {
      throw unavailable();
    }
    const url = await this.guides.mediaUrl(publicId, mediaId, parsed.data);
    await reply.header("cache-control", "public, max-age=60").redirect(url, 302);
  }

  /** Exchanges a stay token for a device session (research R5). JSON only: no form posts. */
  @Post("stay-sessions")
  @HttpCode(200)
  async exchange(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodValidationPipe(stayExchangeSchema)) body: StayExchangeBody,
  ): Promise<StayExchangeResponse> {
    const result = await this.sessions.exchange(
      body.token,
      guestIpKey(request),
      request.headers.cookie,
    );
    if (result.setCookie) void reply.header("set-cookie", result.setCookie);
    return result.body;
  }

  @Get("session")
  session(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(guestSessionQuerySchema)) query: { publicId: string },
  ): Promise<GuestSession> {
    return this.sessions.session(query.publicId, request.headers.cookie);
  }

  @Post("reveals")
  @HttpCode(200)
  async reveal(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body(new ZodValidationPipe(guestRevealSchema)) body: GuestRevealBody,
  ): Promise<RevealResponse> {
    const value = await this.reveals.reveal(body.publicId, body.fieldId, request.headers.cookie);
    void reply.header("cache-control", "no-store").header("pragma", "no-cache");
    return { value };
  }
}
