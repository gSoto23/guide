import { describeError } from "@guidesk/observability";
import type { FastifyInstance } from "fastify";
import { CLIENT_IP_HEADER } from "./client-ip.js";
import { ensureDeviceCookie } from "./device-cookie.js";

const INTERNAL_ERROR = {
  type: "https://guidesk.app/problems/internal_error",
  title: "Internal error",
  status: 500,
  code: "internal_error",
} as const;

export interface FetchHandler {
  handler(request: Request): Promise<Response>;
}

/**
 * Mounts Better Auth's framework-agnostic handler on a Fastify catch-all route (research R2,
 * T018). Avoids the beta NestJS-Fastify wrapper.
 */
export function registerAuthRoutes(
  fastify: FastifyInstance,
  auth: FetchHandler,
  publicOrigin: string,
): void {
  const secure = publicOrigin.startsWith("https://");
  fastify.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      const url = new URL(request.url, publicOrigin);
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) headers.append(key, item);
        } else {
          headers.set(key, String(value));
        }
      }
      // The client address Fastify trusts (proxy hops counted), never a client-sent value (T103).
      headers.set(CLIENT_IP_HEADER, request.ip);
      // Every auth request carries a device cookie, so sign-ins can detect new devices (T058).
      const device = ensureDeviceCookie(headers.get("cookie") ?? undefined, secure);
      headers.set("cookie", device.cookie);

      const hasBody =
        request.method === "POST" && request.body !== undefined && request.body !== null;
      const body = hasBody
        ? typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body)
        : undefined;

      let response: Response;
      try {
        response = await auth.handler(new Request(url, { method: request.method, headers, body }));
      } catch (error) {
        // Never leak driver or library details (SQL, stack traces) to clients.
        request.log.error({ error: describeError(error) }, "auth handler failed");
        return reply
          .status(500)
          .header("content-type", "application/problem+json")
          .send(INTERNAL_ERROR);
      }

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (device.setCookie) cookies.push(device.setCookie);
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      const payload = response.body ? Buffer.from(await response.arrayBuffer()) : null;
      return reply.send(payload);
    },
  });
}
