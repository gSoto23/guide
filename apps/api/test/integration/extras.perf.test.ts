import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ExtraInput, MemberExtra } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  addStay,
  copyStayLink,
  exchange,
  guest,
  publishedGuide,
  type PublishedGuide,
} from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Extras timings (feature 008 T028, plan Performance Budget): with 20 extras and 1,000 stored
 * requests in the workspace, the guest extras route p95 ≤ 150 ms, request creation p95 ≤ 300 ms, and
 * the Requests route p95 ≤ 300 ms at the origin, over 20 requests each. Synthetic data only.
 */
const RUNS = 20;
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let cookie = "";
let extraId = "";

const towels: ExtraInput = {
  sourceLanguage: "es",
  name: { es: "Toallas de playa", en: "Beach towels" },
  description: { es: "Dos toallas grandes.", en: "Two large towels." },
  price: 5,
  currency: "USD",
  leadTimeHours: 0,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  needsDate: false,
  needsTime: false,
  dateRange: "stay",
  maxPerStay: 10,
  preApproved: false,
  turnover: null,
  visible: true,
};

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "extras-perf");
  published = await publishedGuide(ctx, team);
  for (let index = 0; index < 20; index += 1) {
    const created = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/properties/${published.propertyId}/extras`,
      { ...towels, name: { es: `Extra ${index + 1}`, en: `Extra ${index + 1}` } },
    );
    extraId = (created.json() as MemberExtra).id;
  }
  const stayId = await addStay(ctx, team, published.propertyId, 0, 4);
  cookie = (
    await exchange(ctx, (await copyStayLink(ctx, team, published.propertyId, stayId)).token)
  ).cookie!;
  // 1,000 requests across 200 past and current stays, a third of them waiting.
  await db.query(
    `WITH stays AS (
       INSERT INTO stay (workspace_id, property_id, source, check_in_date, checkout_date, channel, guest_name)
       SELECT $1, $2, 'manual', current_date - n, current_date - n + 3, 'Directo', 'Huésped ' || n
         FROM generate_series(1, 200) AS n
       RETURNING id
     )
     INSERT INTO service_request (workspace_id, property_id, stay_id, extra_id, extra_name,
       source_language, price, currency, requested_date, quantity, note, status, expires_at)
     SELECT $1, $2, s.id, $3, '{"es": "Toallas de playa"}', 'es', 5, 'USD', current_date + (k % 5),
            1, 'Nota de prueba ' || k,
            (ARRAY['waiting', 'confirmed', 'declined'])[1 + k % 3], now() + interval '1 day'
       FROM stays s, generate_series(1, 5) AS k`,
    [team.workspaceId, published.propertyId, extraId],
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

async function time(
  run: (index: number) => Promise<{ statusCode: number }>,
  expected: number,
  before?: () => Promise<void>,
): Promise<number> {
  const timings: number[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    await before?.();
    const started = performance.now();
    const response = await run(index);
    timings.push(performance.now() - started);
    expect(response.statusCode).toBe(expected);
  }
  return p95(timings);
}

describe("Extras timings (feature 008 plan)", () => {
  it("answers the guest routes and the Requests route within budget", async () => {
    const count = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM service_request WHERE workspace_id = $1`,
      [team.workspaceId],
    );
    expect(count.rows[0]!.n).toBeGreaterThanOrEqual(1000);
    const list = await time(
      () => guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}/extras?lang=es`),
      200,
    );
    const create = await time(
      () =>
        guest(ctx, "POST", "/api/v1/guest/extras/requests?lang=es", {
          payload: { publicId: published.publicId, extraId, quantity: 1 },
          cookie,
        }),
      201,
      // Each timed request is new: earlier ones are cancelled and aged past the duplicate window.
      async () => {
        await db.query(
          `UPDATE service_request SET status = 'cancelled', created_at = created_at - interval '2 minutes'
            WHERE workspace_id = $1 AND note IS NULL`,
          [team.workspaceId],
        );
      },
    );
    const requests = await time(
      () => wsApi(ctx, team.owner, "GET", team.workspaceId, "/service-requests?status=all&lang=es"),
      200,
    );
    const waiting = await time(
      () =>
        wsApi(
          ctx,
          team.agent,
          "GET",
          team.workspaceId,
          `/service-requests?status=waiting&propertyId=${published.propertyId}`,
        ),
      200,
    );
    expect(list).toBeLessThanOrEqual(150);
    expect(create).toBeLessThanOrEqual(300);
    expect(requests).toBeLessThanOrEqual(300);
    expect(waiting).toBeLessThanOrEqual(300);
  });
});
