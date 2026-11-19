import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  GuestCheckout,
  PaymentRefundResult,
  Payouts,
  ServiceRequestPage,
} from "@guidesk/contracts";
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
 * Refunds, disputes, and payouts totals (feature 013 US3, T014): partial and full refunds, never
 * more than paid (also with 10 at once), agents and stale sign-ins refused, cancelling needs a full
 * refund, disputes flagged, and the month's totals. Synthetic data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let fixture: PaymentsFixture;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  fixture = await paymentsFixture(ctx, db, "refunds");
  await activatePayouts(ctx, fixture);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

/** A paid request for `price` USD; returns its request and order IDs. */
async function paid(price: number): Promise<{ requestId: string; orderId: string }> {
  const request = await requestExtra(ctx, fixture, await addExtra(ctx, fixture, { price }));
  const started = (await checkout(ctx, fixture, request.id)).json() as GuestCheckout;
  expect((await simulated(ctx, started.checkoutUrl, "pay")).statusCode).toBe(303);
  return { requestId: request.id, orderId: started.orderId };
}

const refund = (orderId: string, amountMinor: number, member = fixture.team.owner) =>
  wsApi(ctx, member, "POST", fixture.team.workspaceId, `/payment-orders/${orderId}/refunds`, {
    amountMinor,
  });

describe("refunds (US3, FR-014, FR-015)", () => {
  it("refunds in parts up to what was paid, and the guest sees it", async () => {
    const { requestId, orderId } = await paid(85);
    const part = await refund(orderId, 2000);
    expect(part.statusCode, part.body).toBe(201);
    expect((part.json() as PaymentRefundResult).order).toMatchObject({
      state: "partially_refunded",
      refundedMinor: 2000,
    });
    expect((await refund(orderId, 6501)).json()).toMatchObject({ code: "amount_too_large" });
    const cancel = await wsApi(
      ctx,
      fixture.team.owner,
      "POST",
      fixture.team.workspaceId,
      `/service-requests/${requestId}/cancel?lang=es`,
      { reasonCode: "unavailable" },
    );
    expect(cancel.json()).toMatchObject({ code: "refund_first" });
    expect(((await refund(orderId, 6500)).json() as PaymentRefundResult).order.state).toBe(
      "refunded",
    );
    expect((await refund(orderId, 1)).json()).toMatchObject({ code: "not_refundable" });
    const shown = (await guestRequests(ctx, fixture)).find((r) => r.id === requestId)!.payment;
    expect(shown).toMatchObject({ state: "refunded", refundedMinor: 8500 });
    const logged = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_event WHERE type = 'payment.refunded' AND target_id = $1`,
      [orderId],
    );
    expect(logged.rows[0]!.n).toBe(2);
    expect(
      (
        await wsApi(
          ctx,
          fixture.team.owner,
          "POST",
          fixture.team.workspaceId,
          `/service-requests/${requestId}/cancel?lang=es`,
          { reasonCode: "unavailable" },
        )
      ).statusCode,
    ).toBe(200);
  });

  it("never refunds more than paid with 10 refunds at once", async () => {
    const { orderId } = await paid(30);
    const results = await Promise.all(Array.from({ length: 10 }, () => refund(orderId, 1000)));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(3);
    const { rows } = await db.query<{ refunded_minor: string; status: string }>(
      `SELECT refunded_minor, status FROM payment_order WHERE id = $1`,
      [orderId],
    );
    expect(rows[0]).toEqual({ refunded_minor: "3000", status: "refunded" });
  });

  it("refuses agents and members without a recent sign-in", async () => {
    const { orderId } = await paid(20);
    expect((await refund(orderId, 100, fixture.team.agent)).statusCode).toBe(403);
    await db.query(
      `UPDATE session_assurance SET strong_auth_at = now() - interval '1 hour' WHERE user_id = $1`,
      [fixture.team.admin.userId],
    );
    expect((await refund(orderId, 100, fixture.team.admin)).json()).toMatchObject({
      code: "step_up_required",
    });
    await db.query(`UPDATE session_assurance SET strong_auth_at = now() WHERE user_id = $1`, [
      fixture.team.admin.userId,
    ]);
    expect((await refund(orderId, 100, fixture.team.admin)).statusCode).toBe(201);
  });
});

describe("disputes and totals (FR-016, FR-019, FR-020)", () => {
  it("flags a dispute and shows payments on Requests and Payouts", async () => {
    const { requestId, orderId } = await paid(50);
    const adapter = (await import("../../src/payments/payment-adapter.js")).PAYMENT_ADAPTER;
    const simulatedAdapter = ctx.app.get(
      adapter,
    ) as import("@guidesk/integrations").SimulatedPaymentAdapter;
    const signed = simulatedAdapter.signEvent({
      type: "payment.disputed",
      eventId: `evt-dispute-${orderId}`,
      orderId,
      providerReference: "x",
    });
    const handled = await ctx.fastify.inject({
      method: "POST",
      url: "/api/v1/payments/events/simulated",
      headers: { "content-type": "application/json", ...signed.headers },
      payload: signed.body,
    });
    expect(handled.json()).toEqual({ status: "handled" });
    expect((await refund(orderId, 100)).json()).toMatchObject({ code: "not_refundable" });

    const list = (
      await wsApi(
        ctx,
        fixture.team.agent,
        "GET",
        fixture.team.workspaceId,
        "/service-requests?status=all",
      )
    ).json() as ServiceRequestPage;
    const item = list.items.find((entry) => entry.id === requestId)!;
    expect(item.payment).toMatchObject({
      orderId,
      state: "disputed",
      amountMinor: 5000,
      platformFeeMinor: 500,
    });

    const payouts = (
      await wsApi(ctx, fixture.team.admin, "GET", fixture.team.workspaceId, "/payouts")
    ).json() as Payouts;
    const usd = payouts.month.find((row) => row.currency === "USD")!;
    const { rows } = await db.query<{ paid: string; refunded: string; fees: string }>(
      `SELECT sum(amount_minor) AS paid, sum(refunded_minor) AS refunded, sum(platform_fee_minor) AS fees
         FROM payment_order WHERE workspace_id = $1 AND paid_at IS NOT NULL`,
      [fixture.team.workspaceId],
    );
    expect(usd).toMatchObject({
      paidMinor: Number(rows[0]!.paid),
      refundedMinor: Number(rows[0]!.refunded),
      platformFeeMinor: Number(rows[0]!.fees),
    });
    expect(usd.platformFeeMinor + usd.providerFeeMinor + usd.hostShareMinor).toBe(usd.paidMinor);
  });
});
