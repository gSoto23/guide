import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { from, mergeMap, type Observable } from "rxjs";
import { RateLimitService } from "../common/rate-limit.service.js";
import { ApiProblem } from "../common/problem.js";
import { sha256Hex } from "./guest-context.js";

/** Requests per minute per network address on guest routes (feature 004 FR-053, research R17). */
export const GUEST_REQUESTS_PER_MINUTE = 120;

/** The hashed client address used for guest limits; the address itself is never stored. */
export function guestIpKey(request: FastifyRequest): string {
  return sha256Hex(`guest-ip:${request.ip}`);
}

/**
 * Every guest route: never indexed, no referrer (SEC-02), and a per-address limit so guides can't
 * be scraped or link values guessed at scale (FR-053). Cache headers default to `no-store` in the
 * global hook; only the public guide and media routes set their own.
 */
@Injectable()
export class GuestInterceptor implements NestInterceptor {
  constructor(private readonly rateLimit: RateLimitService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    void reply.header("x-robots-tag", "noindex, nofollow");
    void reply.header("referrer-policy", "no-referrer");
    return from(
      this.rateLimit.consume(`guest:ip:${guestIpKey(request)}`, GUEST_REQUESTS_PER_MINUTE, 60),
    ).pipe(
      mergeMap((limit) => {
        if (!limit.allowed) {
          throw new ApiProblem(429, "rate_limited", undefined, {
            retryAfterSeconds: limit.retryAfterSeconds,
          });
        }
        return next.handle();
      }),
    );
  }
}
