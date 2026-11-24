import { describe, expect, it } from "vitest";
import {
  aiUsageThreshold,
  effectiveLimits,
  effectivePropertyLimit,
  effectiveSeatLimit,
  isPlan,
  limitBasis,
  monthBounds,
  PLAN_LIMITS,
  roomLeft,
  type WorkspacePlan,
} from "../../src/plans/index.js";

const on = (plan: WorkspacePlan["plan"], custom: Partial<WorkspacePlan> = {}): WorkspacePlan => ({
  plan,
  propertyLimit: null,
  seatLimit: null,
  aiReplyMonthlyLimit: null,
  ...custom,
});

describe("plan catalog (feature 011 FR-002, feature 019 FR-001)", () => {
  it("matches the founder's numbers", () => {
    expect(PLAN_LIMITS.free).toEqual({
      properties: 2,
      seats: 1,
      aiReplies: { kind: "fixed", perMonth: 500 },
    });
    expect(PLAN_LIMITS.pro.aiReplies).toEqual({ kind: "pooled", perProperty: 300, minimum: 500 });
    expect(PLAN_LIMITS.business.aiReplies).toEqual({
      kind: "pooled",
      perProperty: 300,
      minimum: 1000,
    });
    expect(PLAN_LIMITS.pro.properties).toBeNull();
    expect(PLAN_LIMITS.pro.seats).toBe(3);
    expect(PLAN_LIMITS.business.seats).toBeNull();
    expect(isPlan("pro")).toBe(true);
    expect(isPlan("enterprise")).toBe(false);
  });
});

describe("effective limits (FR-003, R2)", () => {
  it("uses the plan's values with their source", () => {
    const free = effectiveLimits(on("free"), 1);
    expect(free.properties).toEqual({ limit: 2, source: "plan" });
    expect(free.seats).toEqual({ limit: 1, source: "plan" });
    expect(free.aiReplies).toEqual({
      limit: 500,
      source: "plan",
      perProperty: null,
      minimum: null,
    });
  });

  it("pools 300 AI replies per active property, at least 500 on Pro and 1,000 on Business", () => {
    expect(effectiveLimits(on("pro"), 1).aiReplies).toEqual({
      limit: 500,
      source: "plan",
      perProperty: 300,
      minimum: 500,
    });
    expect(effectiveLimits(on("pro"), 0).aiReplies.limit).toBe(500);
    expect(effectiveLimits(on("pro"), 2).aiReplies.limit).toBe(600);
    expect(effectiveLimits(on("pro"), 5).aiReplies.limit).toBe(1500);
    expect(effectiveLimits(on("business"), 0).aiReplies.limit).toBe(1000);
    expect(effectiveLimits(on("business"), 2).aiReplies.limit).toBe(1000);
    expect(effectiveLimits(on("business"), 4).aiReplies).toEqual({
      limit: 1200,
      source: "plan",
      perProperty: 300,
      minimum: 1000,
    });
  });

  it("lets a custom limit replace one value only", () => {
    const limits = effectiveLimits(on("free", { propertyLimit: 5 }), 3);
    expect(limits.properties).toEqual({ limit: 5, source: "custom" });
    expect(limits.seats).toEqual({ limit: 1, source: "plan" });
    expect(effectiveLimits(on("pro", { aiReplyMonthlyLimit: 50 }), 9).aiReplies).toEqual({
      limit: 50,
      source: "custom",
      perProperty: null,
      minimum: null,
    });
    expect(effectivePropertyLimit(on("pro"))).toBeNull();
    expect(effectiveSeatLimit(on("pro", { seatLimit: 7 }))).toBe(7);
  });
});

describe("derived limit basis (FR-005)", () => {
  it("is the property limit, or the active properties plus 2 when unlimited, never below 2", () => {
    expect(limitBasis(2, 1)).toBe(2);
    expect(limitBasis(25, 1)).toBe(25);
    expect(limitBasis(null, 0)).toBe(2);
    expect(limitBasis(null, 10)).toBe(12);
    expect(limitBasis(1, 0)).toBe(2);
  });

  it("counts room left, with no cap when unlimited", () => {
    expect(roomLeft(2, 1)).toBe(1);
    expect(roomLeft(2, 3)).toBe(0);
    expect(roomLeft(null, 300)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("months and thresholds (FR-007, FR-009)", () => {
  it("bounds the UTC calendar month", () => {
    const bounds = monthBounds(new Date("2026-12-31T23:59:59.000Z"));
    expect(bounds.start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(bounds.resetsAt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(monthBounds(new Date("2027-01-01T00:00:00.000Z")).start.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("reports 80% and 100%", () => {
    expect(aiUsageThreshold(79, 100)).toBeNull();
    expect(aiUsageThreshold(80, 100)).toBe(80);
    expect(aiUsageThreshold(99, 100)).toBe(80);
    expect(aiUsageThreshold(100, 100)).toBe(100);
    expect(aiUsageThreshold(250, 100)).toBe(100);
    expect(aiUsageThreshold(240, 300)).toBe(80);
  });
});
