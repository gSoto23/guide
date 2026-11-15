import { Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AcceptInvitationResponse, InvitationPreview } from "@guidesk/contracts";
import { Public } from "../auth/public.decorator.js";
import { Idempotent } from "../common/idempotency.interceptor.js";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { Inject } from "@nestjs/common";
import { InvitationAcceptService } from "./invitation-accept.service.js";
import { INVITATION_COOKIE } from "./invitation-token.js";

/** Lookups per client IP per 10 minutes; tokens are 256-bit, this only curbs scraping. */
const LOOKUPS_PER_WINDOW = 30;

/** /api/v1/invitations/{token} (contracts/http-api.md, T075). */
@Controller("v1/invitations")
export class InvitationAcceptController {
  constructor(
    private readonly invitations: InvitationAcceptService,
    private readonly rateLimit: RateLimitService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private cookie(value: string, maxAgeSeconds: number): string {
    const secure = this.config.PORTAL_URL.startsWith("https://");
    // Read by the sign-up hook only (/api/auth), so a sign-up from this link, by email code or
    // Google, joins the workspace instead of getting one of its own (FR-020).
    return [
      `${INVITATION_COOKIE}=${value}`,
      "Path=/api/auth",
      `Max-Age=${maxAgeSeconds}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(secure ? ["Secure"] : []),
    ].join("; ");
  }

  @Public()
  @Get(":token")
  async preview(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("token") token: string,
  ): Promise<InvitationPreview> {
    const limit = await this.rateLimit.consume(
      `invite-lookup:${request.ip}`,
      LOOKUPS_PER_WINDOW,
      600,
    );
    if (!limit.allowed) {
      throw new ApiProblem(429, "rate_limited", "Too many requests. Try again later.");
    }
    const preview = await this.invitations.preview(token);
    reply.header("set-cookie", this.cookie(token, 60 * 60));
    return preview;
  }

  @Post(":token/accept")
  @HttpCode(200)
  @Idempotent()
  async accept(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("token") token: string,
  ): Promise<AcceptInvitationResponse> {
    if (!request.auth) throw new ApiProblem(401, "unauthenticated");
    const accepted = await this.invitations.accept(request.auth.user, token);
    reply.header("set-cookie", this.cookie("", 0));
    return accepted;
  }
}
