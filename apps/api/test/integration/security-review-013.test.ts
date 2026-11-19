import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuestCheckout } from "@guidesk/contracts";
import { loadApiConfig } from "../../src/config/config.js";
import { systemQuery } from "./helpers.js";
import {
  activatePayouts,
  addExtra,
  checkout,
  paymentsFixture,
  requestExtra,
  type PaymentsFixture,
} from "./payments-helpers.js";
import { guest } from "./guest-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Security review for feature 013 (T019). AC-SEC-001 (forged and replayed events) and AC-SEC-006
 * (the return never pays) are in payments-checkout.test.ts; AC-SEC-003 and AC-SEC-004 in
 * payments-refunds.test.ts; AC-SEC-005 in cross-tenant.test.ts. This file covers AC-SEC-002 (the
 * server's amount only, no foreign requests), the app role's grants, the checkout rate limit, and
 * AC-SEC-007 (no simulated provider in production). Synthetic data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let fixture: PaymentsFixture;
let other: PaymentsFixture;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  fixture = await paymentsFixture(ctx, db, "secreview013");
  other = await paymentsFixture(ctx, db, "secreview013b");
  await activatePayouts(ctx, fixture);
  await activatePayouts(ctx, other);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

describe("feature 013 security review", () => {
  it("AC-SEC-002: refuses amounts in the body and other stays' requests", async () => {
    const mine = await requestExtra(ctx, fixture, await addExtra(ctx, fixture));
    const tampered = await guest(
      ctx,
      "POST",
      `/api/v1/guest/extras/requests/${mine.id}/checkout?lang=es`,
      {
        payload: { publicId: fixture.published.publicId, amountMinor: 1, currency: "CRC" },
        cookie: fixture.cookie,
      },
    );
    expect(tampered.statusCode).toBe(422);
    const theirs = await requestExtra(ctx, other, await addExtra(ctx, other));
    const foreign = await checkout(ctx, fixture, theirs.id);
    expect(foreign.statusCode).toBe(404);
    const started = (await checkout(ctx, fixture, mine.id)).json() as GuestCheckout;
    const { rows } = await db.query<{ amount_minor: string; currency: string }>(
      `SELECT amount_minor, currency FROM payment_order WHERE id = $1`,
      [started.orderId],
    );
    expect(rows[0]).toEqual({ amount_minor: "8500", currency: "USD" });
  });

  it("gives the app role read-only access to payment tables and none to events", async () => {
    for (const table of ["payment_order", "payment_refund", "payout_account"]) {
      const { rows } = await db.query<{ select: boolean; update: boolean; insert: boolean }>(
        `SELECT has_table_privilege('guidesk_app', $1, 'SELECT') AS select,
                has_table_privilege('guidesk_app', $1, 'UPDATE') AS update,
                has_table_privilege('guidesk_app', $1, 'INSERT') AS insert`,
        [table],
      );
      expect(rows[0], table).toEqual({ select: true, update: false, insert: false });
    }
    const events = await db.query<{ allowed: boolean }>(
      `SELECT has_table_privilege('guidesk_app', 'payment_event', 'SELECT') AS allowed`,
    );
    expect(events.rows[0]!.allowed).toBe(false);
    const fee = await db.query<{ allowed: boolean }>(
      `SELECT has_column_privilege('guidesk_app', 'workspace', 'platform_fee_bps', 'UPDATE') AS allowed`,
    );
    expect(fee.rows[0]!.allowed).toBe(false);
  });

  it("limits checkout starts per stay (SEC-07)", async () => {
    const request = await requestExtra(ctx, other, await addExtra(ctx, other, { price: 10 }));
    const codes: number[] = [];
    for (let i = 0; i < 11; i += 1) codes.push((await checkout(ctx, other, request.id)).statusCode);
    expect(codes.slice(0, 10).every((code) => code === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  it("AC-SEC-007: refuses the simulated provider in production", () => {
    const env = {
      NODE_ENV: "production",
      DATABASE_URL: "postgres://x",
      BETTER_AUTH_SECRET: "x".repeat(48),
      PORTAL_URL: "https://portal.example.com",
      GUIDE_URL: "https://guide.example.com",
      EDGE_SHARED_SECRET: "edge",
      PAYMENTS_MODE: "simulated",
    };
    expect(() => loadApiConfig(env as NodeJS.ProcessEnv)).toThrow(/PAYMENTS_MODE/);
  });
});
