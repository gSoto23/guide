import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuestCheckout } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  activatePayouts,
  addExtra,
  checkout,
  paymentsFixture,
  requestExtra,
  simulated,
  type PaymentsFixture,
} from "./payments-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Payment timings (feature 013 T020, SC-005): starting a checkout and handling the provider's paid
 * event each answer within p95 ≤ 500 ms over 20 requests (the simulated provider adds no network).
 */
const RUNS = 20;
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let fixture: PaymentsFixture;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  fixture = await paymentsFixture(ctx, db, "payments-perf");
  await activatePayouts(ctx, fixture);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
}

describe("Payment timings (feature 013 plan)", () => {
  it("starts checkouts and handles paid events within budget", async () => {
    const starts: number[] = [];
    const events: number[] = [];
    for (let index = 0; index < RUNS; index += 1) {
      // A new extra each round: the same request twice within a minute is refused (spec 008).
      const request = await requestExtra(ctx, fixture, await addExtra(ctx, fixture));
      // Ten checkout starts per stay per hour (SEC-07): clear the counter between rounds.
      await db.query(`DELETE FROM rate_limit_bucket WHERE key LIKE 'checkout:%'`);
      let started = performance.now();
      const response = await checkout(ctx, fixture, request.id);
      starts.push(performance.now() - started);
      expect(response.statusCode, response.body).toBe(200);
      const { checkoutUrl } = response.json() as GuestCheckout;
      started = performance.now();
      const paid = await simulated(ctx, checkoutUrl, "pay");
      events.push(performance.now() - started);
      expect(paid.statusCode).toBe(303);
    }
    expect(p95(starts)).toBeLessThanOrEqual(500);
    expect(p95(events)).toBeLessThanOrEqual(500);
  });
});
