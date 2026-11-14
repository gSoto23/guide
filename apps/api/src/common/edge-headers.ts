import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export interface EdgeInfo {
  country?: string | undefined;
  city?: string | undefined;
}

export const EDGE_SECRET_HEADER = "x-guidesk-edge";

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Location from CloudFront viewer headers, trusted only with the edge secret (research R7). */
export function readEdgeInfo(
  request: FastifyRequest,
  secret: string | undefined,
): EdgeInfo | undefined {
  const provided = header(request, EDGE_SECRET_HEADER);
  if (!secret || !provided || !safeEqual(provided, secret)) {
    return undefined;
  }
  return {
    country: header(request, "cloudfront-viewer-country"),
    city: header(request, "cloudfront-viewer-city"),
  };
}

/**
 * Fastify onRequest hook (T027). In production, requests that bypass CloudFront (and its WAF)
 * are refused, except the load balancer health check.
 */
export function createEdgeHook(options: { secret: string | undefined; enforce: boolean }) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const edge = readEdgeInfo(request, options.secret);
    if (edge) {
      request.edge = edge;
      return;
    }
    if (options.enforce && !request.url.startsWith("/api/health")) {
      await reply.status(403).header("content-type", "application/problem+json").send({
        type: "https://guidesk.app/problems/forbidden",
        title: "Forbidden",
        status: 403,
        code: "forbidden",
      });
    }
  };
}
