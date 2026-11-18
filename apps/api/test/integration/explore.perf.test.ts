import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Explore timings (feature 009 T032, plan Performance Budget): with 60 stored experiences in two
 * languages for the destination, the guest Explore route p95 ≤ 150 ms, the click redirect p95 ≤
 * 300 ms, and the settings routes p95 ≤ 300 ms at the origin, over 20 requests each.
 */
const RUNS = 20;
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "explore-perf");
  published = await publishedGuide(ctx, team);
  await db.query(
    `INSERT INTO experience_destination (key, country, city) VALUES ('cr:samara', 'CR', 'Sámara')
     ON CONFLICT (key) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO experience (partner, product_id, destination_key, language, category, title,
       description, partner_url, fetched_at, expires_at, rating, review_count, price_from, currency)
     SELECT 'viator', 'PERF' || n, 'cr:samara', lang,
            (ARRAY['tours','food_drink','outdoor','water','culture','day_trips','other'])[1 + n % 7],
            'Experiencia ' || n, repeat('Descripción de prueba. ', 20),
            'https://www.viator.com/tours/Test/d901-PERF' || n, now(), now() + interval '1 hour',
            4 + (n % 10) / 10.0, 50 + n, 40 + n, 'USD'
       FROM generate_series(1, 60) AS n, unnest(ARRAY['es', 'en']) AS lang
     ON CONFLICT (partner, product_id, destination_key, language) DO NOTHING`,
  );
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
}

async function time(run: () => Promise<{ statusCode: number }>, expected: number): Promise<number> {
  const timings: number[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    const started = performance.now();
    const response = await run();
    timings.push(performance.now() - started);
    expect(response.statusCode).toBe(expected);
  }
  return p95(timings);
}

describe("Explore timings (feature 009 plan)", () => {
  it("answers the guest route, the redirect, and the settings routes within budget", async () => {
    const list = await time(
      () => guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}/explore?lang=es`),
      200,
    );
    const redirect = await time(
      () =>
        guest(
          ctx,
          "GET",
          `/api/v1/guest/guides/${published.publicId}/experiences/viator-PERF9/go?lang=es`,
          {
            headers: { "user-agent": "Mozilla/5.0 (Test)" },
          },
        ),
      302,
    );
    const settings = await time(
      () =>
        wsApi(
          ctx,
          team.owner,
          "GET",
          team.workspaceId,
          `/properties/${published.propertyId}/explore`,
        ),
      200,
    );
    expect(list).toBeLessThanOrEqual(150);
    expect(redirect).toBeLessThanOrEqual(300);
    expect(settings).toBeLessThanOrEqual(300);
  });
});
