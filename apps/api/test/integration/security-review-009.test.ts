import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { GuestExplore } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Security review for feature 009 on the API side (T029): AC-SEC-001 (no open redirect), AC-SEC-003
 * (no referrer, no caching of the redirect), AC-SEC-004 (agents can't change settings; other
 * workspaces in cross-tenant.test.ts), AC-SEC-005 (no partner call in a guest request), and
 * AC-SEC-006 (clicks counted once per marked tap and at most 60 per address per hour). AC-SEC-002
 * (partner text as text) is in the guest app's explore.test.tsx and the adapter's contract test.
 * Synthetic data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
const KEY = "cr:samara";

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "secreview009");
  published = await publishedGuide(ctx, team);
  await db.query(
    `INSERT INTO experience_destination (key, country, city) VALUES ($1, 'CR', 'Sámara')
     ON CONFLICT (key) DO NOTHING`,
    [KEY],
  );
  await db.query(
    `INSERT INTO experience (partner, product_id, destination_key, language, category, title,
       partner_url, fetched_at, expires_at, rating, review_count)
     VALUES ('viator', 'SEC1', $1, 'es', 'tours', 'Tour de seguridad',
       'https://www.viator.com/tours/Test/d901-SEC1?pid=P00000000', now(), now() + interval '1 hour', 5, 99999)
     ON CONFLICT (partner, product_id, destination_key, language) DO UPDATE SET expires_at = excluded.expires_at`,
    [KEY],
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db.close();
  await ctx.app.close();
});

const go = (path: string, headers: Record<string, string> = {}) =>
  guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}/experiences/${path}`, {
    headers: { "user-agent": "Mozilla/5.0 (Test)", ...headers },
  });

describe("feature 009 security review (API)", () => {
  it("AC-SEC-001: no parameter or ref can send a guest anywhere but a stored partner page", async () => {
    const back = `/g/${published.publicId}/es/explore`;
    for (const path of [
      "viator-SEC1/go?lang=es&url=https://evil.example",
      "viator-SEC1/go?lang=es&next=%2F%2Fevil.example",
      "viator-SEC1/go?lang=https://evil.example",
    ]) {
      const response = await go(path);
      expect(response.statusCode, path).toBe(302);
      expect(response.headers.location, path).toBe(
        "https://www.viator.com/tours/Test/d901-SEC1?pid=P00000000",
      );
    }
    for (const path of [
      "%2F%2Fevil.example/go",
      "viator-%2F%2Fevil.example/go",
      "civitatis-unknown/go?lang=es",
      "javascript:alert(1)/go",
    ]) {
      const response = await go(path);
      expect([302, 404], path).toContain(response.statusCode);
      if (response.statusCode === 302) expect(response.headers.location, path).toBe(back);
    }
  });

  it("AC-SEC-003: the redirect sends no referrer and is never cached", async () => {
    const response = await go("viator-SEC1/go?lang=es");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("AC-SEC-004: an agent can't change Explore settings, and the denial is logged", async () => {
    const before = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_event WHERE workspace_id = $1 AND type = 'access.role_denied'`,
      [team.workspaceId],
    );
    const refused = await wsApi(
      ctx,
      team.agent,
      "PUT",
      team.workspaceId,
      `/properties/${published.propertyId}/explore`,
      {
        version: 0,
        followsDefault: false,
        own: { experiencesEnabled: false, hiddenCategories: [] },
        hiddenExperiences: [],
      },
    );
    expect(refused.statusCode).toBe(403);
    const after = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_event WHERE workspace_id = $1 AND type = 'access.role_denied'`,
      [team.workspaceId],
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n + 1);
  });

  it("AC-SEC-005: guest requests never call a partner", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (/viator|civitatis/.test(url)) {
        calls.push(url);
        throw new Error("partner unreachable");
      }
      return original(input, init);
    }) as typeof fetch);
    try {
      const explore = await guest(
        ctx,
        "GET",
        `/api/v1/guest/guides/${published.publicId}/explore?lang=es`,
      );
      expect(explore.statusCode).toBe(200);
      expect(
        (explore.json() as GuestExplore).categories.flatMap((group) => group.experiences).length,
      ).toBeGreaterThan(0);
      expect((await go("viator-SEC1/go?lang=es")).statusCode).toBe(302);
      expect(calls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("AC-SEC-006: marked clicks count once each, at most 60 per address per hour", async () => {
    const before = await db.query<{ clicks: number }>(
      `SELECT coalesce(sum(clicks), 0)::int AS clicks FROM experience_click_daily WHERE property_id = $1`,
      [published.propertyId],
    );
    const ip = "203.0.113.77";
    for (let index = 0; index < 62; index += 1) {
      await go("viator-SEC1/go?lang=es&c=1", { "x-forwarded-for": ip });
    }
    await go("viator-SEC1/go?lang=es&c=1", {
      "x-forwarded-for": "203.0.113.78",
      "user-agent": "curl/8.0",
    });
    const after = await db.query<{ clicks: number }>(
      `SELECT coalesce(sum(clicks), 0)::int AS clicks FROM experience_click_daily WHERE property_id = $1`,
      [published.propertyId],
    );
    expect(after.rows[0]!.clicks - before.rows[0]!.clicks).toBe(60);
  });
});
