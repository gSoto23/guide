/**
 * Nonce-based Content Security Policy without 'unsafe-inline' for scripts (SEC-11, security
 * review T103). Next.js reads the nonce from the request's CSP header and adds it to its own
 * scripts, so pages render dynamically. Development needs 'unsafe-eval' for React's tooling.
 */
export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  https = true,
  mediaOrigin: string | null = null,
): string {
  // Feature 016 (research R5): signed media URLs live on the media bucket's origin in AWS.
  const media = mediaOrigin ? ` ${mediaOrigin}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${development ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    `img-src 'self' data: blob:${media}`,
    `media-src 'self' blob:${media}`,
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

/** The media origin from the stage, only as a valid https origin (feature 016). */
export function mediaOriginOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
