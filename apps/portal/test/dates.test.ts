import { describe, expect, it } from "vitest";
import { formatDateTime, formatDay, formatRange } from "../lib/dates";

/** Feature 017 FR-013: dates in the reader's language instead of ISO strings. */
describe("formatDay", () => {
  it("formats a date-only string as a calendar date in Spanish and English", () => {
    expect(formatDay("2026-09-26", "es")).toMatch(/^26 sept? 2026$/);
    expect(formatDay("2026-09-26", "en")).toBe("Sep 26, 2026");
  });

  it("never shifts a date-only string by the time zone", () => {
    // Midnight UTC is still the previous day in Costa Rica; a calendar date must not move.
    expect(formatDay("2026-01-01", "en")).toBe("Jan 1, 2026");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatDay("not-a-date", "es")).toBe("not-a-date");
  });
});

describe("formatRange", () => {
  it("collapses a range inside one month", () => {
    expect(formatRange("2026-11-18", "2026-11-22", "es")).toMatch(/^18\s?[–-]\s?22 nov 2026$/);
    expect(formatRange("2026-11-18", "2026-11-22", "en")).toMatch(/^Nov 18\s?[–-]\s?22, 2026$/);
  });

  it("keeps both months when the range crosses a month", () => {
    const text = formatRange("2026-11-28", "2026-12-02", "es");
    expect(text).toContain("28 nov");
    expect(text).toContain("2 dic");
    expect(text).toContain("2026");
  });

  it("keeps both years when the range crosses a year", () => {
    const text = formatRange("2026-12-28", "2027-01-02", "en");
    expect(text).toContain("2026");
    expect(text).toContain("2027");
  });
});

describe("formatDateTime", () => {
  it("adds the time to a date-only string", () => {
    expect(formatDateTime("2026-09-26", "10:00", "en")).toBe("Sep 26, 2026, 10:00");
    expect(formatDateTime("2026-09-26", undefined, "en")).toBe("Sep 26, 2026");
  });
});
