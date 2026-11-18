import type { GuideConfig } from "./config.js";

/**
 * Security and cache headers for every guest app response (feature 004 research R9, R15, SEC-02,
 * SEC-11). There is no inline script or style anywhere, so `'self'` is stricter than a nonce and
 * works with HTML cached by the CDN.
 */
export const CACHE = {
  /** Public guide pages: a minute at the CDN, stale for a day if the origin fails (R9). */
  guide: "public, max-age=0, s-maxage=60, stale-if-error=86400",
  unavailable: "public, max-age=0, s-maxage=60",
  private: "private, no-store",
  noStore: "no-store",
  immutable: "public, max-age=31536000, immutable",
  day: "public, max-age=86400",
  hour: "public, max-age=0, s-maxage=3600",
  revalidate: "no-cache",
} as const;

export function contentSecurityPolicy(config: GuideConfig): string {
  const media = config.mediaOrigin ? ` ${config.mediaOrigin}` : "";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data:${media}`,
    `media-src 'self'${media}`,
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders(config: GuideConfig): Record<string, string> {
  return {
    "content-security-policy": contentSecurityPolicy(config),
    "x-robots-tag": "noindex, nofollow",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), publickey-credentials-get=()",
    ...(config.secure
      ? { "strict-transport-security": "max-age=63072000; includeSubDomains; preload" }
      : {}),
  };
}
