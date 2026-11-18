/**
 * The service worker's routing rules (feature 004 contracts/guide-web.md, research R9), kept pure
 * so they can be tested without a browser. Personal guest API responses are never stored.
 */
export type Strategy = "page" | "static" | "media" | "network" | "navigate-other" | "ignore";

export function strategyFor(url: URL, mode: string, method: string, origin: string): Strategy {
  if (method !== "GET" || url.origin !== origin) return "ignore";
  const path = url.pathname;
  if (path.startsWith("/api/v1/guest/media/")) return "media";
  if (path.startsWith("/api/")) return "network";
  if (path.startsWith("/assets/") || path.startsWith("/icons/")) return "static";
  if (mode === "navigate")
    return /^\/g\/[a-z2-7]{26}\/(es|en)(\/|$)/.test(path) ? "page" : "navigate-other";
  return "ignore";
}

/** Only complete, shareable responses are saved for offline reading. */
export function storable(status: number, type: string, cacheControl: string | null): boolean {
  if (status !== 200 || (type !== "basic" && type !== "default")) return false;
  return !/no-store|private/i.test(cacheControl ?? "");
}

/** Media responses may be opaque (cross-origin redirects to signed URLs). */
export function storableMedia(status: number, type: string): boolean {
  return type === "opaque" || status === 200;
}

/** Marks a saved page so the page script shows the offline banner with the saved time. */
export function markOffline(html: string, savedAt: string): string {
  return html.replace(
    'data-offline-at=""',
    `data-offline-at="${savedAt.replace(/[^0-9TZ:.-]/g, "")}"`,
  );
}

/** The guide a page or media URL belongs to, for removing a guide that is no longer available. */
export function guideOf(path: string): string | null {
  const page = /^\/g\/([a-z2-7]{26})(\/|$)/.exec(path);
  if (page) return page[1]!;
  const media = /^\/api\/v1\/guest\/media\/([a-z2-7]{26})\//.exec(path);
  return media ? media[1]! : null;
}
