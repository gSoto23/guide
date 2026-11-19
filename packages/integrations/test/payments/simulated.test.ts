import { describe, expect, it } from "vitest";
import {
  createPaymentAdapter,
  SIGNATURE_HEADER,
  SimulatedPaymentAdapter,
  simulatedFee,
} from "../../src/index.js";

/** The simulated provider (feature 013 T003): signed tokens and events, never trusted unsigned. */
const adapter = createPaymentAdapter("simulated", {
  secret: "test-secret-".padEnd(48, "x"),
  pagesUrl: "http://localhost:3000/",
}) as SimulatedPaymentAdapter;

describe("simulated payment adapter", () => {
  it("creates a checkout page URL with a signed token", async () => {
    const checkout = await adapter.createCheckout({
      orderId: "order-1",
      amountMinor: 8500,
      currency: "USD",
      description: "Recogida",
      merchantAccountId: "sim_merchant_1",
      platformFeeMinor: 850,
      returnUrl: "http://127.0.0.1:3001/g/x/es/extras?payment=order-1",
      expiresAt: new Date("2026-11-19T13:00:00Z"),
    });
    expect(checkout.checkoutUrl).toMatch(
      /^http:\/\/localhost:3000\/api\/v1\/simulated-provider\/checkout\?token=/,
    );
    const token = new URL(checkout.checkoutUrl).searchParams.get("token")!;
    expect(adapter.readToken(token)).toMatchObject({
      kind: "checkout",
      orderId: "order-1",
      amountMinor: 8500,
      providerReference: checkout.providerReference,
    });
    const [body] = token.split(".");
    expect(adapter.readToken(`${body}.forged`)).toBeNull();
  });

  it("verifies signed events and refuses tampered or unsigned ones", () => {
    const { body, headers } = adapter.signEvent({
      type: "payment.succeeded",
      eventId: "evt-1",
      orderId: "order-1",
      providerReference: "sim_1",
      amountMinor: 8500,
      currency: "USD",
      providerFeeMinor: simulatedFee(8500, "USD"),
    });
    const parsed = JSON.parse(JSON.stringify(body)) as unknown;
    expect(adapter.verifyEvent(parsed, headers)).toMatchObject({ type: "payment.succeeded" });
    expect(adapter.verifyEvent({ ...body, amountMinor: 1 }, headers)).toBeNull();
    expect(adapter.verifyEvent(body, {})).toBeNull();
    const other = createPaymentAdapter("simulated", {
      secret: "another-secret-".padEnd(48, "y"),
      pagesUrl: "http://localhost:3000",
    })!;
    expect(other.verifyEvent(parsed, headers)).toBeNull();
    expect(headers[SIGNATURE_HEADER]).toBeTruthy();
  });

  it("charges an illustrative fee and refunds at once; off has no adapter", async () => {
    expect(simulatedFee(8500, "USD")).toBe(387);
    expect(simulatedFee(1_000_000, "CRC")).toBe(57_000);
    await expect(
      adapter.refund({ orderId: "o", providerReference: "p", amountMinor: 100, currency: "USD" }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(createPaymentAdapter("off", { secret: "x", pagesUrl: "http://x" })).toBeNull();
    expect(() => createPaymentAdapter("tilopay", { secret: "x", pagesUrl: "http://x" })).toThrow();
  });
});
