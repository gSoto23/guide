import type { INestApplication } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AUTH_INSTANCE, type GuideskAuth } from "./auth/auth.js";
import { registerAuthRoutes } from "./auth/auth.route.js";
import { createEdgeHook } from "./common/edge-headers.js";
import { API_CONFIG, type ApiConfig } from "./config/config.js";

/** Proxy hops whose X-Forwarded-For entries Fastify trusts when computing request.ip (T103). */
export function trustedProxyHops(config: Pick<ApiConfig, "NODE_ENV" | "TRUSTED_PROXY_HOPS">) {
  return config.TRUSTED_PROXY_HOPS ?? (config.NODE_ENV === "production" ? 2 : 1);
}

/**
 * Fastify adapter shared by main.ts and integration tests. Nest's own body parsers are off
 * (`bodyParser: false` at app creation), so only Fastify's JSON and text parsers run and HTML
 * form posts are never parsed into request bodies (CSRF hardening, T103).
 */
export function createFastifyAdapter(
  config: Pick<ApiConfig, "NODE_ENV" | "TRUSTED_PROXY_HOPS">,
): FastifyAdapter {
  const hops = trustedProxyHops(config);
  // Same as Fastify's numeric trustProxy: trust the socket peer and the next hops - 1 entries.
  return new FastifyAdapter({ trustProxy: (_address: string, hop: number) => hop < hops });
}

export const NEST_APP_OPTIONS = { bodyParser: false, bufferLogs: true } as const;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function forbidden(reply: FastifyReply) {
  return reply.status(403).header("content-type", "application/problem+json").send({
    type: "https://guidesk.app/problems/forbidden",
    title: "Forbidden",
    status: 403,
    code: "forbidden",
  });
}

/**
 * Cookie-authenticated state changes must come from the portal's own origin (SEC-11, T103).
 * Browsers send Origin on every non-GET request and Sec-Fetch-Site on modern versions; a
 * mismatch on either is refused. Requests without both (server-to-server tools) carry no browser
 * cookies to abuse. Better Auth applies its own origin check to /api/auth/*.
 */
export function createOriginHook(portalUrl: string) {
  const portalOrigin = new URL(portalUrl).origin;
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (SAFE_METHODS.has(request.method) || request.url.startsWith("/api/auth/")) return;
    const origin = request.headers.origin;
    const site = request.headers["sec-fetch-site"];
    if (origin !== undefined && origin !== portalOrigin) {
      await forbidden(reply);
      return;
    }
    if (site !== undefined && site !== "same-origin" && site !== "none") {
      await forbidden(reply);
    }
  };
}

/** Response headers for every API response (SEC-04, SEC-11, T103). */
export function createSecurityHeadersHook(secure: boolean) {
  return async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("x-frame-options", "DENY");
    reply.header("cross-origin-resource-policy", "same-origin");
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    if (secure) {
      reply.header("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
    }
  };
}

/** Shared setup for main.ts and integration tests: prefix, edge hook, and auth routes. */
export function configureApp(app: NestFastifyApplication | INestApplication): void {
  const fastifyApp = app as NestFastifyApplication;
  const config = fastifyApp.get<ApiConfig>(API_CONFIG);
  const auth = fastifyApp.get<GuideskAuth>(AUTH_INSTANCE);
  const fastify = fastifyApp.getHttpAdapter().getInstance();

  fastifyApp.setGlobalPrefix("api");
  fastify.addHook(
    "onRequest",
    createEdgeHook({
      secret: config.EDGE_SHARED_SECRET,
      enforce: config.NODE_ENV === "production",
    }),
  );
  fastify.addHook("onRequest", createOriginHook(config.PORTAL_URL));
  fastify.addHook("onSend", createSecurityHeadersHook(config.PORTAL_URL.startsWith("https://")));
  registerAuthRoutes(fastify, auth, config.PORTAL_URL);
}
