import { describe, expect, it } from "vitest";
import { quietWindow } from "../../src/agent/quiet-hours.js";

const night = { start: "22:00", end: "07:00" };
const siesta = { start: "13:00", end: "15:00" };

describe("quiet hours (feature 007 research R6)", () => {
  it("is active late at night and ends the next morning, in the property's zone", () => {
    // 23:10 in Costa Rica (UTC-6) is 05:10 UTC the next day.
    const window = quietWindow(new Date("2026-11-19T05:10:00Z"), "America/Costa_Rica", night);
    expect(window.active).toBe(true);
    expect(window.endsAt?.toISOString()).toBe("2026-11-19T13:00:00.000Z");
    expect(window.endsAtLocal).toBe("07:00");
  });

  it("is active after midnight and ends the same morning", () => {
    const window = quietWindow(new Date("2026-11-19T09:00:00Z"), "America/Costa_Rica", night);
    expect(window.active).toBe(true);
    expect(window.endsAt?.toISOString()).toBe("2026-11-19T13:00:00.000Z");
  });

  it("is not active in the day", () => {
    expect(quietWindow(new Date("2026-11-19T18:00:00Z"), "America/Costa_Rica", night).active).toBe(
      false,
    );
    // The end itself is outside the window.
    expect(quietWindow(new Date("2026-11-19T13:00:00Z"), "America/Costa_Rica", night).active).toBe(
      false,
    );
  });

  it("handles a window within a day", () => {
    const inside = quietWindow(new Date("2026-11-19T20:30:00Z"), "America/Costa_Rica", siesta);
    expect(inside.active).toBe(true);
    expect(inside.endsAt?.toISOString()).toBe("2026-11-19T21:00:00.000Z");
    expect(quietWindow(new Date("2026-11-19T21:30:00Z"), "America/Costa_Rica", siesta).active).toBe(
      false,
    );
  });

  it("follows daylight saving changes", () => {
    // New York leaves DST on 2026-11-01: 07:00 local is 11:00 UTC before and 12:00 UTC after.
    const before = quietWindow(new Date("2026-10-31T04:00:00Z"), "America/New_York", night);
    expect(before.endsAt?.toISOString()).toBe("2026-10-31T11:00:00.000Z");
    const after = quietWindow(new Date("2026-11-01T05:00:00Z"), "America/New_York", night);
    expect(after.endsAt?.toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });

  it("is never active without a zone, hours, a valid zone, or with equal times", () => {
    const now = new Date("2026-11-19T05:10:00Z");
    expect(quietWindow(now, null, night).active).toBe(false);
    expect(quietWindow(now, "America/Costa_Rica", null).active).toBe(false);
    expect(quietWindow(now, "Mars/Olympus", night).active).toBe(false);
    expect(quietWindow(now, "America/Costa_Rica", { start: "22:00", end: "22:00" }).active).toBe(
      false,
    );
  });
});
