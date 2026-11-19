/**
 * Guest app settings (feature 004 research R2, R3). Locally from the repository's .env; in AWS
 * from the function's environment. Nothing here is a secret.
 */
export interface GuideConfig {
  /** Where server-side rendering fetches guide data (the API, or the guide origin in AWS). */
  apiUrl: string;
  /** Origin that serves media (signed URLs), allowed by the CSP. */
  mediaOrigin: string | null;
  /** True on HTTPS deployments: HSTS. */
  secure: boolean;
  /** Fixture guide for Lighthouse CI only; never set in AWS (research R19). */
  fixtures: boolean;
  /** Sent to the API so it accepts the renderer's direct calls in AWS (feature 002 research R7). */
  edgeSecret: string | null;
  /** Feature 009: HTTPS origins of partner photos, allowed by the CSP (research R9). */
  experienceImageOrigins: string[];
  /** Feature 014: the portal's origin, where the privacy policy lives. */
  portalUrl: string;
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GuideConfig {
  const apiUrl = env.GUIDE_API_URL ?? env.API_URL ?? "http://localhost:4000";
  return {
    apiUrl: apiUrl.replace(/\/$/, ""),
    mediaOrigin: originOf(env.GUIDE_MEDIA_URL ?? env.LOCAL_MEDIA_URL ?? apiUrl),
    secure: (env.GUIDE_URL ?? "").startsWith("https://"),
    fixtures: env.GUIDE_FIXTURES === "true",
    edgeSecret: env.EDGE_SHARED_SECRET || null,
    experienceImageOrigins: (env.EXPERIENCE_IMAGE_ORIGINS ?? "")
      .split(",")
      .map((value) => originOf(value.trim()))
      .filter((origin): origin is string => origin !== null && origin.startsWith("https://")),
    portalUrl: originOf(env.PORTAL_URL) ?? "http://localhost:3000",
  };
}
