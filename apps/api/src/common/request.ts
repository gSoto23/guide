import type { AuthSession } from "@guidesk/integrations";
import type { EdgeInfo } from "./edge-headers.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by SessionGuard on authenticated routes. */
    auth?: AuthSession;
    /** Set by the edge hook when the request came through CloudFront (research R7). */
    edge?: EdgeInfo;
  }
}

/** Converts Node/Fastify headers to Fetch API Headers. */
export function toWebHeaders(raw: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}
