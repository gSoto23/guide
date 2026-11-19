import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuestCheckout, Payouts } from "@guidesk/contracts";
import { SimulatedPaymentAdapter } from "@guidesk/integrations";
import { PAYMENT_ADAPTER } from "../../src/payments/payment-adapter.js";
import { systemQuery } from "./helpers.js";
import {
  activatePayouts,
  addExtra,
  checkout,
  guestRequests,
  paymentsFixture,
  requestExtra,
  simulated,
  type PaymentsFixture,
} from "./payments-helpers.js";
import { wsApi } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Payouts and guest checkout (feature 013 US2 and US1, T007, T010): onboarding through the simulated
 * provider, payable rules, one open checkout per request, orders paid only by verified events, fees
 * that add up, repeated and forged events, and paid-after-cancel flagged for a refund. Synthetic data.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let fixture: PaymentsFixture;
let adapter: SimulatedPaymentAdapter;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  fixture = await paymentsFixture(ctx, db, "payments");
  adapter = ctx.app.get(PAYMENT_ADAPTER) as SimulatedPaymentAdapter;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const payouts = async (member = fixture.team.owner) =>
  (await wsApi(ctx, member, "GET", fixture.team.workspaceId, "/payouts")).json() as Payouts;

const order = async (orderId: string) =>
  (
    await db.query<{
      status: string;
      amount_minor: string;
      platform_fee_minor: string;
      provider_fee_minor: string | null;
      host_share_minor: string | null;
      refund_due: boolean;
      provider_reference: string | null;
    }>(`SELECT * FROM payment_order WHERE id = $1`, [orderId])
  ).rows[0]!;

describe("payouts (US2, FR-002, FR-003)", () => {
  it("lets only the owner set up payouts, through the provider's page", async () => {
    expect(await payouts()).toMatchObject({
      mode: "simulated",
      account: null,
      feePercent: 10,
      feeSource: "plan",
      canManage: true,
      month: [],
    });
    expect((await payouts(fixture.team.agent)).canManage).toBe(false);
    const byAdmin = await wsApi(
      ctx,
      fixture.team.admin,
      "POST",
      fixture.team.workspaceId,
      "/payouts/onboarding",
    );
    expect(byAdmin.statusCode).toBe(403);

    const started = await wsApi(
      ctx,
      fixture.team.owner,
      "POST",
      fixture.team.workspaceId,
      "/payouts/onboarding?lang=es",
    );
    const url = (started.json() as { onboardingUrl: string }).onboardingUrl;
    const pageView = await simulated(ctx, url);
    expect(pageView.statusCode).toBe(200);
    expect(pageView.body).toContain("Simulated payment provider");
    const rejected = await simulated(ctx, url, "reject");
    expect(rejected.statusCode).toBe(303);
    expect(rejected.headers.location).toBe("http://localhost:3000/es/settings/payouts");
    expect((await payouts()).account).toEqual({ provider: "simulated", status: "rejected" });

    const extraId = await addExtra(ctx, fixture);
    const request = await requestExtra(ctx, fixture, extraId);
    expect(request.status).toBe("confirmed");
    expect(request.payment).toBeNull();
    expect((await checkout(ctx, fixture, request.id)).statusCode).toBe(409);

    await activatePayouts(ctx, fixture);
    expect((await guestRequests(ctx, fixture))[0]!.payment).toEqual({
      state: "payable",
      amountMinor: 8500,
      currency: "USD",
      refundedMinor: 0,
      reference: null,
    });
  });
});

describe("guest checkout (US1)", () => {
  let paidOrder = "";

  it("reuses one open checkout and shows processing until a verified event", async () => {
    const [request] = await guestRequests(ctx, fixture);
    const first = await checkout(ctx, fixture, request!.id);
    expect(first.statusCode, first.body).toBe(200);
    const started = first.json() as GuestCheckout;
    expect(started.checkoutUrl).toContain("/api/v1/simulated-provider/checkout?token=");
    const again = (await checkout(ctx, fixture, request!.id)).json() as GuestCheckout;
    expect(again.orderId).toBe(started.orderId);
    expect((await guestRequests(ctx, fixture))[0]!.payment?.state).toBe("open");
    // Returning with a "paid" query changes nothing (AC-SEC-006).
    expect((await order(started.orderId)).status).toBe("open");

    const paid = await simulated(ctx, started.checkoutUrl, "pay");
    expect(paid.statusCode).toBe(303);
    expect(paid.headers.location).toBe(
      `http://127.0.0.1:3001/g/${fixture.published.publicId}/es/extras?payment=${started.orderId}`,
    );
    const stored = await order(started.orderId);
    expect(stored).toMatchObject({
      status: "paid",
      amount_minor: "8500",
      platform_fee_minor: "850",
      provider_fee_minor: "387",
      host_share_minor: "7263",
      refund_due: false,
    });
    const shown = (await guestRequests(ctx, fixture))[0]!.payment!;
    expect(shown).toMatchObject({ state: "paid", amountMinor: 8500 });
    expect(shown.reference).toBe(stored.provider_reference);
    expect((await checkout(ctx, fixture, request!.id)).json()).toMatchObject({
      code: "already_paid",
    });
    const job = await db.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'payment.notify' AND data->>'orderId' = $1 AND data->>'kind' = 'paid'`,
      [started.orderId],
    );
    expect(job.rowCount).toBe(1);
    paidOrder = started.orderId;
  });

  it("handles a repeated event once and refuses forged or tampered ones", async () => {
    const event = {
      type: "payment.succeeded" as const,
      eventId: "evt-replay-1",
      orderId: paidOrder,
      providerReference: "sim_x",
      amountMinor: 8500,
      currency: "USD",
      providerFeeMinor: 1,
    };
    const signed = adapter.signEvent(event);
    const post = (payload: object, headers: Record<string, string>) =>
      ctx.fastify.inject({
        method: "POST",
        url: "/api/v1/payments/events/simulated",
        headers: { "content-type": "application/json", ...headers },
        payload,
      });
    expect((await post(signed.body, signed.headers)).json()).toEqual({ status: "handled" });
    expect((await post(signed.body, signed.headers)).json()).toEqual({ status: "duplicate" });
    // Already paid: the second payment event changes nothing.
    expect((await order(paidOrder)).provider_fee_minor).toBe("387");
    const forged = await post({ ...event, eventId: "evt-forged" }, signed.headers);
    expect(forged.statusCode).toBe(400);
    const unsigned = await post({ ...event, eventId: "evt-unsigned" }, {});
    expect(unsigned.statusCode).toBe(400);
    const refused = await db.query(
      `SELECT 1 FROM security_event WHERE type = 'payment.event_refused'`,
    );
    expect(refused.rowCount).toBeGreaterThanOrEqual(2);
    expect(
      (
        await ctx.fastify.inject({
          method: "POST",
          url: "/api/v1/payments/events/tilopay",
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });

  it("refuses requests that can't be paid online", async () => {
    const free = await requestExtra(ctx, fixture, await addExtra(ctx, fixture, { price: 0 }));
    const euros = await requestExtra(
      ctx,
      fixture,
      await addExtra(ctx, fixture, { currency: "EUR" }),
    );
    const waiting = await requestExtra(
      ctx,
      fixture,
      await addExtra(ctx, fixture, { preApproved: false, leadTimeHours: 1 }),
    );
    for (const request of [free, euros, waiting]) {
      expect(request.payment, request.name).toBeNull();
      expect((await checkout(ctx, fixture, request.id)).json()).toMatchObject({
        code: "not_payable",
      });
    }
    expect((await checkout(ctx, fixture, "00000000-0000-4000-8000-000000000000")).statusCode).toBe(
      404,
    );
  });

  it("flags a payment that arrives after the host cancelled the request", async () => {
    const request = await requestExtra(ctx, fixture, await addExtra(ctx, fixture, { price: 40 }));
    const started = (await checkout(ctx, fixture, request.id)).json() as GuestCheckout;
    const cancelled = await wsApi(
      ctx,
      fixture.team.owner,
      "POST",
      fixture.team.workspaceId,
      `/service-requests/${request.id}/cancel?lang=es`,
      { reasonCode: "unavailable" },
    );
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    await simulated(ctx, started.checkoutUrl, "pay");
    expect(await order(started.orderId)).toMatchObject({ status: "paid", refund_due: true });
  });

  it("marks a declined payment failed and lets the guest try again", async () => {
    const request = await requestExtra(ctx, fixture, await addExtra(ctx, fixture, { price: 12 }));
    const first = (await checkout(ctx, fixture, request.id)).json() as GuestCheckout;
    await simulated(ctx, first.checkoutUrl, "decline");
    expect((await order(first.orderId)).status).toBe("failed");
    expect(
      (await guestRequests(ctx, fixture)).find((r) => r.id === request.id)?.payment?.state,
    ).toBe("payable");
    const second = (await checkout(ctx, fixture, request.id)).json() as GuestCheckout;
    expect(second.orderId).not.toBe(first.orderId);
  });
});
