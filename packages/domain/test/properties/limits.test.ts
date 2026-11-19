import { describe, expect, it } from "vitest";
import {
  extractionLimit,
  extractionLimitResetsAt,
  nextRefreshAllowedAt,
  refreshAllowed,
} from "../../src/properties/limits.js";

describe("extraction limit (FR-017)", () => {
  it("is twice the property limit, with a minimum of 10 per UTC day", () => {
    expect(extractionLimit(2)).toBe(10);
    expect(extractionLimit(5)).toBe(10);
    expect(extractionLimit(6)).toBe(12);
    expect(extractionLimit(40)).toBe(80);
  });

  it("resets at the next UTC midnight", () => {
    expect(extractionLimitResetsAt(new Date("2026-11-16T23:59:59.000Z")).toISOString()).toBe(
      "2026-11-17T00:00:00.000Z",
    );
    expect(extractionLimitResetsAt(new Date("2026-11-16T00:00:00.000Z")).toISOString()).toBe(
      "2026-11-17T00:00:00.000Z",
    );
  });
});

describe('"Refresh now" (FR-023, FR-035)', () => {
  const now = new Date("2026-11-16T12:00:00.000Z");

  it("is allowed once every 5 minutes", () => {
    expect(refreshAllowed(null, now)).toBe(true);
    expect(refreshAllowed(new Date("2026-11-16T11:55:00.000Z"), now)).toBe(true);
    expect(refreshAllowed(new Date("2026-11-16T11:55:00.001Z"), now)).toBe(false);
    expect(refreshAllowed(new Date("2026-11-16T11:59:00.000Z"), now)).toBe(false);
  });

  it("tells when the next one is allowed", () => {
    expect(nextRefreshAllowedAt(new Date("2026-11-16T11:58:00.000Z")).toISOString()).toBe(
      "2026-11-16T12:03:00.000Z",
    );
  });
});
