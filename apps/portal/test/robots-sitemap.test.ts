import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../app/manifest";
import robots from "../app/robots";
import sitemap from "../app/sitemap";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("robots.txt (feature 014 FR-012, AC-SEC-005)", () => {
  it("allows only the public pages and names the sitemap", () => {
    vi.stubEnv("PORTAL_URL", "https://app.example.com");
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        allow: ["/es$", "/en$", "/es/privacy", "/en/privacy", "/es/terms", "/en/terms"],
        disallow: "/",
      },
      sitemap: "https://app.example.com/sitemap.xml",
    });
  });
});

describe("sitemap.xml (feature 014 FR-012, AC-SEC-005)", () => {
  it("lists exactly the six public URLs with alternates", () => {
    vi.stubEnv("PORTAL_URL", "https://app.example.com");
    const entries = sitemap();
    expect(entries.map((entry) => entry.url)).toEqual([
      "https://app.example.com/es",
      "https://app.example.com/en",
      "https://app.example.com/es/privacy",
      "https://app.example.com/en/privacy",
      "https://app.example.com/es/terms",
      "https://app.example.com/en/terms",
    ]);
    expect(entries[2]?.alternates?.languages).toEqual({
      es: "https://app.example.com/es/privacy",
      en: "https://app.example.com/en/privacy",
    });
    for (const entry of entries) {
      expect(entry.url).not.toMatch(/\/(g|s|api|start|properties|sign-in)\b/);
    }
  });
});

describe("installed app (feature 014 FR-013)", () => {
  it("starts at the signed-in start page", () => {
    expect(manifest()).toMatchObject({ start_url: "/start", scope: "/" });
  });
});
