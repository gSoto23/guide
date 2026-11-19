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
  exploreQuerySchema,
  guestCancelRequestSchema,
  guestCheckoutSchema,
  type GuestCheckout,
  type GuestCheckoutBody,
  guestRequestsQuerySchema,
  guestServiceRequestSchema,
  type GuestExtras,
  type GuestServiceRequest,
  type GuestServiceRequestBody,
  type GuestServiceRequests,
  guestGuideQuerySchema,
  guestOpenSchema,
  guestRevealSchema,
  guestSessionQuerySchema,
  guestVerifySchema,
  stayExchangeSchema,
  type GuestExplore,
  type GuestGuide,
  type GuestOpenBody,
  type GuestRevealBody,
  type GuestSession,
  type GuestVerifyBody,
  type RevealResponse,
  type StayExchangeBody,
  type StayExchangeResponse,
} from "@guidesk/contracts";
import { Public } from "../auth/public.decorator.js";
import { assertUuid } from "../common/ids.js";
import { ApiProblem } from "../common/problem.js";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { GuestExploreService } from "./explore.service.js";
import { GuestExtrasService } from "./extras.service.js";
import { GuestGuideService, GUEST_MEDIA_VARIANTS } from "./guest-guide.service.js";
import { guestIpKey, GuestInterceptor } from "./guest.interceptor.js";
import { unavailable } from "./guest-context.js";
import { GuestOpens } from "./opens.service.js";
import { GuestReveals } from "./reveals.service.js";
import { GuestSessions } from "./sessions.service.js";
import { GuestVerification } from "./verification.service.js";

/**
 * Public guide data (feature 004 R9): cached by the CDN for a minute, served stale for a day if
 * the origin fails. It never carries session state or locked values, so sharing it is safe.
 */
export const PUBLIC_GUIDE_CACHE = "public, max-age=0, s-maxage=60, stale-if-error=86400";
/** Explore keeps partner content at most an hour (Viator's limit), so stale copies stay short. */
export const PUBLIC_EXPLORE_CACHE = "public, max-age=0, s-maxage=60, stale-if-error=600";

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
    private readonly verification: GuestVerification,
    private readonly opens: GuestOpens,
    private readonly explore: GuestExploreService,
    private readonly extras: GuestExtrasService,
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

  /** Feature 009: the host's tips and the selected experiences (contracts/http-api.md). */
  @Get("guides/:publicId/explore")
  async exploreList(
    @Param("publicId") publicId: string,
    @Query(new ZodValidationPipe(exploreQuerySchema)) query: z.infer<typeof exploreQuerySchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<GuestExplore> {
    const result = await this.explore.explore(publicId, query.lang);
    void reply.header("cache-control", PUBLIC_EXPLORE_CACHE);
    return result;
  }

  /**
   * Feature 009: "Book on {partner}" (research R8). Always a redirect; only `lang` and `c` are read,
   * and no parameter can choose where it leads.
   */
  @Get("guides/:publicId/experiences/:ref/go")
  async experienceRedirect(
    @Param("publicId") publicId: string,
    @Param("ref") ref: string,
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const location = await this.explore.redirect(
      publicId,
      ref,
      query.lang === "en" ? "en" : "es",
      query.c === "1",
      request.headers["user-agent"],
      guestIpKey(request),
    );
    await reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer")
      .redirect(location, 302);
  }

  /** Feature 008: the property's visible extras (contracts/http-api.md). */
  @Get("guides/:publicId/extras")
  async extrasList(
    @Param("publicId") publicId: string,
    @Query(new ZodValidationPipe(exploreQuerySchema)) query: z.infer<typeof exploreQuerySchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<GuestExtras> {
    const result = await this.extras.list(publicId, query.lang);
    void reply.header("cache-control", PUBLIC_EXPLORE_CACHE);
    return result;
  }

  /** Feature 008: this stay's requests and whether this device may request (stay session). */
  @Get("extras/requests")
  async extrasRequests(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(guestRequestsQuerySchema.extend(exploreQuerySchema.shape)))
    query: { publicId: string; lang?: "es" | "en" },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<GuestServiceRequests> {
    void reply.header("cache-control", "no-store");
    return this.extras.requests(query.publicId, request.headers.cookie, query.lang);
  }

  @Post("extras/requests")
  @HttpCode(201)
  async extrasRequest(
    @Req() request: FastifyRequest,
    @Query(new ZodValidationPipe(exploreQuerySchema)) query: z.infer<typeof exploreQuerySchema>,
    @Body(new ZodValidationPipe(guestServiceRequestSchema)) body: GuestServiceRequestBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<GuestServiceRequest> {
    void reply.header("cache-control", "no-store");
    return this.extras.create(body, request.headers.cookie, query.lang);
  }

  /** Feature 013: starts or reuses the request's checkout (contracts/http-api.md). */
  @Post("extras/requests/:requestId/checkout")
  @HttpCode(200)
  async extrasCheckout(
    @Req() request: FastifyRequest,
    @Param("requestId") requestId: string,
    @Query(new ZodValidationPipe(exploreQuerySchema)) query: z.infer<typeof exploreQuerySchema>,
    @Body(new ZodValidationPipe(guestCheckoutSchema)) body: GuestCheckoutBody,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<GuestCheckout> {
    try {
      assertUuid(requestId);
    } catch {
      throw new ApiProblem(404, "not_found");
    }
    void reply.header("cache-control", "no-store");
    return this.extras.checkout(requestId, body.publicId, request.headers.cookie, query.lang);
  }

  @Post("extras/requests/:requestId/cancel")
  @HttpCode(200)
  async extrasCancel(
    @Req() request: FastifyRequest,
    @Param("requestId") requestId: string,
    @Query(new ZodValidationPipe(exploreQuerySchema)) query: z.infer<typeof exploreQuerySchema>,
    @Body(new ZodValidationPipe(guestCancelRequestSchema)) body: { publicId: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<GuestServiceRequest> {
    try {
      assertUuid(requestId);
    } catch {
      throw unavailable();
    }
    void reply.header("cache-control", "no-store");
    return this.extras.cancel(requestId, body.publicId, request.headers.cookie, query.lang);
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

  @Post("verify")
  @HttpCode(204)
  async verify(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(guestVerifySchema)) body: GuestVerifyBody,
  ): Promise<void> {
    await this.verification.verify(
      body.publicId,
      body.code,
      request.headers.cookie,
      guestIpKey(request),
    );
  }

  @Post("opens")
  @HttpCode(204)
  async open(
    @Req() request: FastifyRequest,
    @Body(new ZodValidationPipe(guestOpenSchema)) body: GuestOpenBody,
  ): Promise<void> {
    await this.opens.record(
      body.publicId,
      body.kind,
      request.headers["user-agent"],
      guestIpKey(request),
    );
  }
}
