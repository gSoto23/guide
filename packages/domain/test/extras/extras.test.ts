import { describe, expect, it } from "vitest";
import {
  canTransition,
  checkRequest,
  isoWeekday,
  localized,
  type ExtraRules,
  type RequestContext,
} from "../../src/extras/index.js";

/** Request rules (feature 008 T003, research R2): every rule, expiry, pre-approval. Synthetic data. */
const base: ExtraRules = {
  leadTimeHours: 24,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  needsDate: true,
  needsTime: true,
  dateRange: "before_arrival",
  maxPerStay: 1,
  preApproved: false,
  turnover: null,
};

// Costa Rica is UTC-6 all year.
const context: RequestContext = {
  stay: { checkInDate: "2026-12-11", checkoutDate: "2026-12-15" },
  timeZone: "America/Costa_Rica",
  now: new Date("2026-12-01T15:00:00Z"),
  usedQuantity: 0,
  otherStays: [],
};

describe("request rules (research R2)", () => {
  it("accepts a valid request, waiting, and expires at the moment minus the lead time", () => {
    const result = checkRequest(base, { date: "2026-12-11", time: "16:30", quantity: 1 }, context);
    expect(result).toEqual({
      ok: true,
      date: "2026-12-11",
      time: "16:30",
      status: "waiting",
      // 16:30 local = 22:30 UTC on the 11th, minus 24 hours.
      expiresAt: new Date("2026-12-10T22:30:00Z"),
    });
    expect(
      checkRequest(
        { ...base, preApproved: true },
        { date: "2026-12-11", time: "16:30", quantity: 1 },
        context,
      ),
    ).toMatchObject({ ok: true, status: "confirmed" });
  });

  it("refuses each broken rule with its code", () => {
    const check = (rules: Partial<ExtraRules>, input: object, ctx: Partial<RequestContext> = {}) =>
      checkRequest({ ...base, ...rules }, { quantity: 1, ...input }, { ...context, ...ctx });
    expect(check({}, { time: "10:00" })).toEqual({ ok: false, rule: "needs_date" });
    expect(check({}, { date: "2026-02-30", time: "10:00" })).toEqual({
      ok: false,
      rule: "needs_date",
    });
    expect(check({}, { date: "2026-12-11" })).toEqual({ ok: false, rule: "needs_time" });
    expect(check({}, { date: "2026-12-11", time: "25:00" })).toEqual({
      ok: false,
      rule: "needs_time",
    });
    expect(check({}, { date: "2026-12-12", time: "10:00" })).toEqual({
      ok: false,
      rule: "date_range",
    });
    expect(check({}, { date: "2026-11-30", time: "10:00" })).toEqual({
      ok: false,
      rule: "date_range",
    });
    expect(check({ dateRange: "stay" }, { date: "2026-12-16", time: "10:00" })).toEqual({
      ok: false,
      rule: "date_range",
    });
    // 2026-12-11 is a Friday (5).
    expect(isoWeekday("2026-12-11")).toBe(5);
    expect(check({ weekdays: [1, 2, 3] }, { date: "2026-12-11", time: "10:00" })).toEqual({
      ok: false,
      rule: "weekday",
    });
    expect(
      check({}, { date: "2026-12-02", time: "08:00" }, { now: new Date("2026-12-01T15:00:00Z") }),
    ).toEqual({ ok: false, rule: "lead_time" });
    expect(check({}, { date: "2026-12-11", time: "10:00" }, { usedQuantity: 1 })).toEqual({
      ok: false,
      rule: "max_per_stay",
    });
    expect(check({ maxPerStay: 3 }, { date: "2026-12-11", time: "10:00", quantity: 0 })).toEqual({
      ok: false,
      rule: "quantity",
    });
  });

  it("applies the turnover rule on the stay's own dates", () => {
    const early = {
      ...base,
      needsDate: false,
      needsTime: false,
      turnover: "early_check_in" as const,
      leadTimeHours: 0,
    };
    expect(checkRequest(early, { quantity: 1 }, context)).toMatchObject({
      ok: true,
      date: "2026-12-11",
    });
    expect(
      checkRequest(
        early,
        { quantity: 1 },
        {
          ...context,
          otherStays: [{ checkInDate: "2026-12-08", checkoutDate: "2026-12-11" }],
        },
      ),
    ).toEqual({ ok: false, rule: "turnover" });
    const late = { ...early, turnover: "late_checkout" as const };
    expect(
      checkRequest(
        late,
        { quantity: 1 },
        {
          ...context,
          otherStays: [{ checkInDate: "2026-12-15", checkoutDate: "2026-12-18" }],
        },
      ),
    ).toEqual({ ok: false, rule: "turnover" });
    expect(checkRequest(late, { quantity: 1 }, context)).toMatchObject({
      ok: true,
      date: "2026-12-15",
    });
  });

  it("expires requests without a date after 48 hours", () => {
    const undated = { ...base, needsDate: false, needsTime: false };
    const result = checkRequest(undated, { quantity: 1 }, context);
    expect(result).toMatchObject({ ok: true, date: null, time: null });
    if (result.ok) {
      expect(result.expiresAt.getTime() - context.now.getTime()).toBe(48 * 3_600_000);
    }
  });
});

describe("statuses and texts", () => {
  it("allows only the data model's transitions", () => {
    expect(canTransition("waiting", "confirmed")).toBe(true);
    expect(canTransition("waiting", "expired")).toBe(true);
    expect(canTransition("confirmed", "host_cancelled")).toBe(true);
    expect(canTransition("confirmed", "declined")).toBe(false);
    expect(canTransition("expired", "confirmed")).toBe(false);
    expect(canTransition("declined", "confirmed")).toBe(false);
  });

  it("falls back to the source language", () => {
    expect(localized({ es: "Recogida" }, "en", "es")).toEqual({ text: "Recogida", language: "es" });
    expect(localized({ es: "Recogida", en: "Pickup" }, "en", "es")).toEqual({
      text: "Pickup",
      language: "en",
    });
  });
});
