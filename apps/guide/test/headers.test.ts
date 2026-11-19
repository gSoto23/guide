import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../src/headers.js";
import { fixtureHandler, FIXTURE_PUBLIC_ID, get } from "./helpers.js";

/** Security headers on every guest response (feature 004 T017, research R15, SEC-02, SEC-11). */
describe("guest app headers", () => {
  it("sets a strict CSP without inline scripts or styles, noindex, and no referrer", async () => {
    const response = await fixtureHandler()(get(`/g/${FIXTURE_PUBLIC_ID}/es`));
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data: https://media.example.com");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("strict-transport-security")).toBeNull();
    const body = await response.text();
    expect(body).toContain('<meta name="robots" content="noindex, nofollow"/>');
    // Every script is an external file or a JSON data block: nothing inline runs.
    const scripts = body.match(/<script\b[^>]*>/gi) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toMatch(/\bsrc="|type="application\/json"/);
    expect(body).not.toMatch(/\sstyle="/);
  });

  it("adds HSTS on HTTPS deployments", async () => {
    const response = await fixtureHandler({ secure: true })(get("/"));
    expect(response.headers.get("strict-transport-security")).toContain("max-age=63072000");
  });

  it("allows no media origin when none is configured", () => {
    const csp = contentSecurityPolicy({
      apiUrl: "http://api",
      mediaOrigin: null,
      secure: false,
      fixtures: false,
      edgeSecret: null,
      experienceImageOrigins: [],
      portalUrl: "http://localhost:3000",
    });
    expect(csp).toContain("img-src 'self' data:;");
  });
});
