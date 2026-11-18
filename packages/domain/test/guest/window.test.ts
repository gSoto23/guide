import { describe, expect, it } from "vitest";
import { stayWindow, zonedTimeToInstant } from "../../src/guest/window.js";

const property = { timeZone: "America/Costa_Rica", checkInTime: "15:00", checkoutTime: "11:00" };

describe("stay window (feature 004 FR-027, research R6)", () => {
  it("opens at 00:00 on the check-in day and closes 2 hours after checkout, in the property's zone", () => {
    const window = stayWindow(
      {
        checkInDate: "2026-12-12",
        checkoutDate: "2026-12-15",
        checkInTime: null,
        checkoutTime: null,
      },
      property,
    );
    // Costa Rica is UTC-6 all year.
    expect(window.opensAt.toISOString()).toBe("2026-12-12T06:00:00.000Z");
    expect(window.closesAt.toISOString()).toBe("2026-12-15T19:00:00.000Z");
    expect(window.checkInTime).toBe("15:00");
    expect(window.checkoutTime).toBe("11:00");
  });

  it("uses the stay's own times when set", () => {
    const window = stayWindow(
      {
        checkInDate: "2026-12-12",
        checkoutDate: "2026-12-15",
        checkInTime: "16:30:00",
        checkoutTime: "10:00:00",
      },
      property,
    );
    expect(window.closesAt.toISOString()).toBe("2026-12-15T18:00:00.000Z");
    expect(window.checkInTime).toBe("16:30");
    expect(window.checkoutTime).toBe("10:00");
  });

  it("handles daylight saving changes in a US zone", () => {
    // 2026-03-08 is the start of daylight saving time in New York (UTC-5 to UTC-4).
    expect(zonedTimeToInstant("2026-03-08", "00:00", "America/New_York").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(zonedTimeToInstant("2026-03-09", "13:00", "America/New_York").toISOString()).toBe(
      "2026-03-09T17:00:00.000Z",
    );
    // 2026-11-01 is the end of daylight saving time (UTC-4 to UTC-5).
    expect(zonedTimeToInstant("2026-11-01", "12:00", "America/New_York").toISOString()).toBe(
      "2026-11-01T17:00:00.000Z",
    );
  });

  it("refuses unknown zones and malformed times", () => {
    expect(() => zonedTimeToInstant("2026-12-12", "00:00", "Mars/Olympus")).toThrow();
    expect(() => zonedTimeToInstant("2026-12-12", "25:00", "UTC")).toThrow();
    expect(() => zonedTimeToInstant("12/12/2026", "10:00", "UTC")).toThrow();
  });
});
