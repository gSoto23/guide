import type { GuestGuide } from "@guidesk/contracts";
import type { GuideConfig } from "./config.js";
import { fixtureGuide } from "./fixtures/guide.js";

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
