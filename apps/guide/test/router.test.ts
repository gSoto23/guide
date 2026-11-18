import { describe, expect, it } from "vitest";
import { fixtureHandler, FIXTURE_PUBLIC_ID, get } from "./helpers.js";

/** The guest app's routes and cache policies (feature 004 T017, contracts/guide-web.md). */
const handle = fixtureHandler();

describe("guest app routes", () => {
  it("redirects the bare property link by language cookie, then Accept-Language (R10)", async () => {
    const byHeader = await handle(
      get(`/g/${FIXTURE_PUBLIC_ID}`, { "accept-language": "en-US,en;q=0.9" }),
    );
    expect(byHeader.status).toBe(302);
    expect(byHeader.headers.get("location")).toBe(`/g/${FIXTURE_PUBLIC_ID}/en`);
    expect(byHeader.headers.get("cache-control")).toBe("private, no-store");
    const byCookie = await handle(
      get(`/g/${FIXTURE_PUBLIC_ID}`, { "accept-language": "en", cookie: "guidesk_lang=es" }),
    );
    expect(byCookie.headers.get("location")).toBe(`/g/${FIXTURE_PUBLIC_ID}/es`);
    const fallback = await handle(get(`/g/${FIXTURE_PUBLIC_ID}`, { "accept-language": "fr-FR" }));
    expect(fallback.headers.get("location")).toBe(`/g/${FIXTURE_PUBLIC_ID}/es`);
  });

  it("serves guide pages with the public cache policy", async () => {
    for (const path of ["", "/emergency", "/00000000-0000-4000-8000-000000000001"]) {
      const response = await handle(get(`/g/${FIXTURE_PUBLIC_ID}/es${path}`));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("cache-control")).toBe(
        "public, max-age=0, s-maxage=60, stale-if-error=86400",
      );
      expect(response.headers.get("content-type")).toContain("text/html");
    }
  });

  it("answers unknown guides, sections, and languages with the unavailable page", async () => {
    for (const path of [
      "/g/abcdefghijklmnopqrstuvwxyz/es",
      `/g/${FIXTURE_PUBLIC_ID}/fr`,
      `/g/${FIXTURE_PUBLIC_ID}/es/00000000-0000-4000-8000-0000000000ff`,
      `/g/${FIXTURE_PUBLIC_ID}/es/not-a-section`,
      "/nothing/here",
    ]) {
      const response = await handle(get(path));
      expect(response.status, path).toBe(404);
      const body = await response.text();
      expect(body).toContain("Esta guía no está disponible");
      expect(body).not.toContain("Casa Demo");
    }
  });

  it("serves the exchange page without looking the token up, never cached (R5)", async () => {
    const response = await handle(get(`/s/${"A".repeat(43)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).toContain('id="exchange"');
    expect(body).toContain("<noscript>");
    expect(body).not.toContain("A".repeat(43));
  });

  it("serves the service worker, manifest, offline page, and root", async () => {
    const sw = await handle(get("/sw.js"));
    expect(sw.status).toBe(200);
    expect(sw.headers.get("cache-control")).toBe("no-cache");
    expect(sw.headers.get("content-type")).toContain("javascript");
    const manifest = await handle(get("/manifest.webmanifest"));
    expect(((await manifest.json()) as { start_url: string }).start_url).toBe("/");
    expect((await handle(get("/offline"))).status).toBe(200);
    expect((await handle(get("/"))).status).toBe(200);
  });

  it("refuses other methods and path tricks", async () => {
    const post = await handle(new Request("http://127.0.0.1:3001/", { method: "POST" }));
    expect(post.status).toBe(405);
    expect((await handle(get("/assets/..%2F..%2Fpackage.json"))).status).toBe(404);
  });
});
