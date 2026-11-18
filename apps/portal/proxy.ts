import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

/**
 * Nonce-based Content Security Policy without 'unsafe-inline' for scripts (SEC-11, security
 * review T103). Next.js reads the nonce from the request's CSP header and adds it to its own
 * scripts, so pages render dynamically. Development needs 'unsafe-eval' for React's tooling.
 */
export function contentSecurityPolicy(nonce: string, development: boolean, https = true): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${development ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    // Feature 006: the push service worker and the web app manifest (research R7).
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

// Locale detection: URL prefix, then cookie, then Accept-Language (research R13).
export default function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const https =
    request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development", https);
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
