import { describe, expect, it } from "vitest";
import {
  changeOf,
  countedReason,
  countedTopic,
  isComparable,
  periodBounds,
  questionOutcome,
  rateOf,
} from "../../src/analytics/index.js";

/** Feature 010 (T002): periods, changes, rates, and question outcomes. */
describe("periods (research R2)", () => {
  it("ends today in the property's zone and puts the previous period right before", () => {
    // 23:30 on 17 November in Costa Rica is already the 18th in UTC.
    const now = new Date("2026-11-18T05:30:00Z");
    expect(periodBounds(7, "America/Costa_Rica", now)).toEqual({
      today: "2026-11-17",
      from: "2026-11-11",
      previousFrom: "2026-11-04",
      previousTo: "2026-11-10",
    });
    expect(periodBounds(7, null, now).today).toBe("2026-11-18");
    const ninety = periodBounds(90, "UTC", new Date("2026-03-01T12:00:00Z"));
    expect(ninety.from).toBe("2025-12-02");
    expect(ninety.previousTo).toBe("2025-12-01");
    expect(ninety.previousFrom).toBe("2025-09-03");
  });

  it("compares only when the previous period started after creation (research R7)", () => {
    const now = new Date("2026-11-18T18:00:00Z");
    // The previous 7 days start on 5 November.
    expect(isComparable(7, "UTC", new Date("2026-11-05T10:00:00Z"), now)).toBe(true);
    expect(isComparable(7, "UTC", new Date("2026-11-06T10:00:00Z"), now)).toBe(false);
    expect(isComparable(30, "UTC", new Date("2026-11-01T00:00:00Z"), now)).toBe(false);
  });
});

describe("changes and rates (FR-004, FR-015)", () => {
  it("gives the absolute and relative change, and no relative change from zero", () => {
    expect(changeOf(20, 10)).toEqual({ absolute: 10, relative: 1 });
    expect(changeOf(5, 10)).toEqual({ absolute: -5, relative: -0.5 });
    expect(changeOf(3, 0)).toEqual({ absolute: 3, relative: null });
  });

  it("has no rate without a denominator", () => {
    expect(rateOf(14, 20)).toBe(0.7);
    expect(rateOf(0, 0)).toBeNull();
  });
});

describe("question outcomes (research R3)", () => {
  it("maps trace decisions to outcomes and leaves greetings out", () => {
    expect(questionOutcome("answered")).toBe("automatic");
    expect(questionOutcome("pointer")).toBe("automatic");
    expect(questionOutcome("drafted")).toBe("with_host");
    expect(questionOutcome("paused")).toBe("with_host");
    expect(questionOutcome("held")).toBe("escalated");
    expect(questionOutcome("greeting")).toBeNull();
  });

  it("counts real reasons and topics only", () => {
    expect(countedReason("emergency")).toBe("emergency");
    expect(countedReason("not_confident")).toBe("not_confident");
    expect(countedReason("draft_ready")).toBeNull();
    expect(countedReason("taken_over")).toBeNull();
    expect(countedReason(null)).toBeNull();
    expect(countedTopic("wifi")).toBe("wifi");
    expect(countedTopic("greeting")).toBeNull();
    expect(countedTopic(undefined)).toBe("other");
    expect(countedTopic("something_new")).toBe("other");
  });
});
