import { describe, expect, it } from "vitest";
import {
  guideOf,
  markOffline,
  storable,
  storableMedia,
  strategyFor,
} from "../src/client/sw-rules.js";

/** Service worker rules (feature 004 T056, research R9, SEC-04). */
const origin = "https://guide.example.com";
const at = (path: string) => new URL(path, origin);
const id = "abcdefghijklmnopqrstuvwxyz";

describe("service worker rules", () => {
  it("routes guide pages, static files, and media, and never stores other guest API calls", () => {
    expect(strategyFor(at(`/g/${id}/es`), "navigate", "GET", origin)).toBe("page");
    expect(
      strategyFor(
        at(`/g/${id}/en/00000000-0000-4000-8000-000000000001`),
        "navigate",
        "GET",
        origin,
      ),
    ).toBe("page");
    expect(strategyFor(at(`/g/${id}`), "navigate", "GET", origin)).toBe("navigate-other");
    expect(strategyFor(at("/assets/guide.abc.js"), "no-cors", "GET", origin)).toBe("static");
    expect(strategyFor(at(`/api/v1/guest/media/${id}/m/large`), "no-cors", "GET", origin)).toBe(
      "media",
    );
    for (const path of [
      "/api/v1/guest/session?publicId=x",
      "/api/v1/guest/reveals",
      `/api/v1/guest/guides/${id}`,
    ]) {
      expect(strategyFor(at(path), "cors", "GET", origin)).toBe("network");
    }
    expect(strategyFor(at("/api/v1/guest/reveals"), "cors", "POST", origin)).toBe("ignore");
    expect(strategyFor(new URL("https://elsewhere.example.com/x"), "navigate", "GET", origin)).toBe(
      "ignore",
    );
  });

  it("stores only complete, shareable responses", () => {
    expect(storable(200, "basic", "public, max-age=0, s-maxage=60")).toBe(true);
    expect(storable(200, "basic", "no-store")).toBe(false);
    expect(storable(200, "basic", "private, no-store")).toBe(false);
    expect(storable(302, "basic", null)).toBe(false);
    expect(storable(200, "opaqueredirect", null)).toBe(false);
    expect(storableMedia(0, "opaque")).toBe(true);
    expect(storableMedia(404, "basic")).toBe(false);
  });

  it("marks a saved page with its time, and only with a clean timestamp", () => {
    const html = '<html lang="es" data-offline-at="">';
    expect(markOffline(html, "2026-12-12T21:40:00.000Z")).toBe(
      '<html lang="es" data-offline-at="2026-12-12T21:40:00.000Z">',
    );
    expect(markOffline(html, '"><script>')).toBe('<html lang="es" data-offline-at="">');
  });

  it("finds the guide a cached URL belongs to", () => {
    expect(guideOf(`/g/${id}/es/x`)).toBe(id);
    expect(guideOf(`/api/v1/guest/media/${id}/m/large`)).toBe(id);
    expect(guideOf("/offline")).toBeNull();
  });
});
