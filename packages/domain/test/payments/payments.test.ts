import { describe, expect, it } from "vitest";
import {
  currentStatus,
  isPayableRequest,
  platformFeeBps,
  refundableMinor,
  splitAmounts,
  statusAfterRefund,
  toMinor,
} from "../../src/payments/index.js";

describe("platform fees (feature 013 FR-012)", () => {
  it("uses the plan's fee or a custom one", () => {
    expect(platformFeeBps("free", null)).toBe(1000);
    expect(platformFeeBps("pro", null)).toBe(700);
    expect(platformFeeBps("business", undefined)).toBe(500);
    expect(platformFeeBps("business", 400)).toBe(400);
    expect(platformFeeBps("free", 0)).toBe(0);
  });
});

describe("amounts (FR-011, SC-003)", () => {
  it("multiplies the price by the quantity in minor units", () => {
    expect(toMinor("85.00", 1)).toBe(8500);
    expect(toMinor(12.5, 3)).toBe(3750);
    expect(toMinor("0.1", 3)).toBe(30);
  });

  it("splits so the parts add up to the amount", () => {
    for (const [amount, bps, provider] of [
      [8500, 1000, 328],
      [3750, 700, 161],
      [1, 1000, 30],
      [999, 500, 0],
      [100, 3000, 500],
    ] as const) {
      const split = splitAmounts(amount, bps, provider);
      expect(split.platformFeeMinor + split.providerFeeMinor + split.hostShareMinor).toBe(amount);
      expect(split.hostShareMinor).toBeGreaterThanOrEqual(0);
    }
    expect(splitAmounts(8500, 1000, 328)).toEqual({
      platformFeeMinor: 850,
      providerFeeMinor: 328,
      hostShareMinor: 7322,
    });
  });
});

describe("payable requests (FR-004)", () => {
  const base = { status: "confirmed", price: "85.00", currency: "USD", turnover: null };
  it("needs a confirmed, priced request in USD or CRC that is not a turnover extra", () => {
    expect(isPayableRequest(base)).toBe(true);
    expect(isPayableRequest({ ...base, currency: "CRC" })).toBe(true);
    expect(isPayableRequest({ ...base, status: "waiting" })).toBe(false);
    expect(isPayableRequest({ ...base, price: "0.00" })).toBe(false);
    expect(isPayableRequest({ ...base, currency: "EUR" })).toBe(false);
    expect(isPayableRequest({ ...base, turnover: "late_checkout" })).toBe(false);
  });
});

describe("order states (R3)", () => {
  it("expires open orders after their time and tracks refunds", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(currentStatus("open", new Date("2026-11-19T11:59:59Z"), now)).toBe("expired");
    expect(currentStatus("open", new Date("2026-11-19T12:30:00Z"), now)).toBe("open");
    expect(currentStatus("paid", new Date("2026-11-19T11:00:00Z"), now)).toBe("paid");
    expect(refundableMinor({ amountMinor: 8500, refundedMinor: 2000 })).toBe(6500);
    expect(statusAfterRefund(8500, 2000)).toBe("partially_refunded");
    expect(statusAfterRefund(8500, 8500)).toBe("refunded");
  });
});
