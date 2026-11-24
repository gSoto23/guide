import { describe, expect, it } from "vitest";
import type { CalendarStay } from "@guidesk/contracts";
import {
  agenda,
  barSpan,
  daysInMonth,
  monthRange,
  shiftMonth,
  staysOn,
  todayIn,
  weekdayIndex,
} from "../lib/calendar";

/** Calendar helpers (feature 018 US1). Fictional data. */
const stay = (id: string, checkInDate: string, checkoutDate: string): CalendarStay => ({
  id,
  propertyId: "p",
  checkInDate,
  checkoutDate,
  checkInTime: "15:00",
  checkoutTime: "11:00",
  source: "manual",
  channel: "Directo",
  status: "active",
  mayBeBlock: false,
  overlaps: false,
  guestName: null,
  guestCount: null,
  bookingReference: null,
  marks: { linkOpened: false, openEscalation: false, waitingRequests: 0, confirmedExtras: 0 },
});

describe("months", () => {
  it("bounds a month and moves across years", () => {
    expect(monthRange({ year: 2031, month: 12 })).toEqual({ from: "2031-12-01", to: "2032-01-01" });
    expect(shiftMonth({ year: 2031, month: 1 }, -1)).toEqual({ year: 2030, month: 12 });
    expect(daysInMonth({ year: 2032, month: 2 })).toHaveLength(29);
    expect(weekdayIndex("2031-03-03")).toBe(0); // a Monday
    expect(todayIn("America/Costa_Rica", new Date("2031-03-01T03:00:00Z"))).toBe("2031-02-28");
  });
});

describe("bars", () => {
  it("covers the nights, cut at the month edges", () => {
    const march = { year: 2031, month: 3 };
    expect(barSpan(stay("a", "2031-03-10", "2031-03-14"), march)).toEqual({
      start: 10,
      end: 13,
      cutStart: false,
      cutEnd: false,
    });
    expect(barSpan(stay("b", "2031-03-28", "2031-04-03"), march)).toEqual({
      start: 28,
      end: 31,
      cutStart: false,
      cutEnd: true,
    });
    expect(barSpan(stay("c", "2031-02-27", "2031-03-02"), march)).toEqual({
      start: 1,
      end: 1,
      cutStart: true,
      cutEnd: false,
    });
    expect(barSpan(stay("d", "2031-02-27", "2031-03-01"), march)).toBeNull();
  });
});

describe("agenda", () => {
  it("lists arrivals, stays in progress, and departures by day", () => {
    const stays = [stay("a", "2031-03-10", "2031-03-12"), stay("b", "2031-03-11", "2031-03-13")];
    const days = agenda(stays, { year: 2031, month: 3 });
    expect(days.map((day) => day.date)).toEqual([
      "2031-03-10",
      "2031-03-11",
      "2031-03-12",
      "2031-03-13",
    ]);
    expect(days[1]).toMatchObject({
      arrivals: [expect.objectContaining({ id: "b" })],
      staying: [expect.objectContaining({ id: "a" })],
      departures: [],
    });
    expect(staysOn(stays, "2031-03-12").map((item) => item.id)).toEqual(["b"]);
  });
});
