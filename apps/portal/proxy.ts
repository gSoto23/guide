import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { contentSecurityPolicy, mediaOriginOf } from "./lib/csp";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

// Locale detection: URL prefix, then cookie, then Accept-Language (research R13).
export default function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const https =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
    https,
    mediaOriginOf(process.env.MEDIA_ORIGIN),
  );
  // next-intl forwards the request headers to rendering, where Next.js picks up the nonce.
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);
  const response = handleI18nRouting(request);
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
