import type { GuestExplore, GuestExtras, GuestGuide } from "@guidesk/contracts";
import type { GuideConfig } from "./config.js";
import { fixtureExplore, fixtureExtras, fixtureGuide } from "./fixtures/guide.js";

export type GuideResult =
  | { kind: "ok"; guide: GuestGuide }
  | { kind: "unavailable" }
  | { kind: "rate_limited" }
  | { kind: "error" };

/** Reads the public guide from the API's guest route (contracts/http-api.md). */
export async function fetchGuide(
  config: GuideConfig,
  publicId: string,
  lang: "es" | "en",
  forwardedFor?: string,
): Promise<GuideResult> {
  if (config.fixtures) {
    const guide = fixtureGuide(publicId, lang);
    return guide ? { kind: "ok", guide } : { kind: "unavailable" };
  }
  try {
    const response = await fetch(`${config.apiUrl}/api/v1/guest/guides/${publicId}?lang=${lang}`, {
      headers: {
        accept: "application/json",
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
        ...(config.edgeSecret ? { "x-guidesk-edge": config.edgeSecret } : {}),
      },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return { kind: "unavailable" };
    if (response.status === 429) return { kind: "rate_limited" };
    if (!response.ok) return { kind: "error" };
    return { kind: "ok", guide: (await response.json()) as GuestGuide };
  } catch {
    return { kind: "error" };
  }
}

export type ExploreResult =
  | { kind: "ok"; explore: GuestExplore }
  | { kind: "unavailable" }
  | { kind: "rate_limited" }
  | { kind: "error" };

type Fetched<T> =
  { kind: "ok"; data: T } | { kind: "unavailable" } | { kind: "rate_limited" } | { kind: "error" };

/** A public guest route on the API, for server-side rendering. */
async function getPublic<T>(
  config: GuideConfig,
  path: string,
  forwardedFor?: string,
): Promise<Fetched<T>> {
  try {
    const response = await fetch(`${config.apiUrl}/api/v1/guest/${path}`, {
      headers: {
        accept: "application/json",
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
        ...(config.edgeSecret ? { "x-guidesk-edge": config.edgeSecret } : {}),
      },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 404) return { kind: "unavailable" };
    if (response.status === 429) return { kind: "rate_limited" };
    if (!response.ok) return { kind: "error" };
    return { kind: "ok", data: (await response.json()) as T };
  } catch {
    return { kind: "error" };
  }
}

/** Feature 009: the host's tips and the selected experiences (contracts/http-api.md). */
export async function fetchExplore(
  config: GuideConfig,
  publicId: string,
  lang: "es" | "en",
  forwardedFor?: string,
): Promise<ExploreResult> {
  if (config.fixtures) {
    const explore = fixtureExplore(publicId, lang);
    return explore ? { kind: "ok", explore } : { kind: "unavailable" };
  }
  const result = await getPublic<GuestExplore>(
    config,
    `guides/${publicId}/explore?lang=${lang}`,
    forwardedFor,
  );
  return result.kind === "ok" ? { kind: "ok", explore: result.data } : result;
}

export type ExtrasResult =
  | { kind: "ok"; extras: GuestExtras }
  | { kind: "unavailable" }
  | { kind: "rate_limited" }
  | { kind: "error" };

/** Feature 008: the property's visible extras (contracts/http-api.md). */
export async function fetchExtras(
  config: GuideConfig,
  publicId: string,
  lang: "es" | "en",
  forwardedFor?: string,
): Promise<ExtrasResult> {
  if (config.fixtures) {
    const extras = fixtureExtras(publicId, lang);
    return extras ? { kind: "ok", extras } : { kind: "unavailable" };
  }
  const result = await getPublic<GuestExtras>(
    config,
    `guides/${publicId}/extras?lang=${lang}`,
    forwardedFor,
  );
  return result.kind === "ok" ? { kind: "ok", extras: result.data } : result;
}
