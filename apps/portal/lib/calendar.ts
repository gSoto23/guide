import type { CalendarStay } from "@guidesk/contracts";

/**
 * Feature 018 helpers for the calendar (pure, client-side). Dates are `YYYY-MM-DD` strings in each
 * property's own calendar, so no time-zone math happens here; "today" comes from the property's
 * time zone. A stay covers its nights: from the check-in day up to the day before checkout.
 */

export interface Month {
  year: number;
  /** 1–12 */
  month: number;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Today's date in a time zone (the device's when none is given). */
export function todayIn(timeZone?: string | null, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function monthOf(date: string): Month {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

export function shiftMonth(month: Month, delta: number): Month {
  const index = month.year * 12 + (month.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The month's first day and the next month's first day: the calendar read's `[from, to)`. */
export function monthRange(month: Month): { from: string; to: string } {
  const next = shiftMonth(month, 1);
  return { from: isoDate(month.year, month.month, 1), to: isoDate(next.year, next.month, 1) };
}

export function daysInMonth(month: Month): string[] {
  const count = new Date(Date.UTC(month.year, month.month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => isoDate(month.year, month.month, index + 1));
}

/** 0 = Monday … 6 = Sunday, for the month grid. */
export function weekdayIndex(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return (day + 6) % 7;
}

function addDays(date: string, days: number): string {
  const time = new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

export interface BarSpan {
  /** 1-based first column (day of the month). */
  start: number;
  /** 1-based last column, inclusive. */
  end: number;
  /** The stay started before this month or continues after it. */
  cutStart: boolean;
  cutEnd: boolean;
}

/** Where a stay's nights fall in a month, or null when none do. */
export function barSpan(
  stay: Pick<CalendarStay, "checkInDate" | "checkoutDate">,
  month: Month,
): BarSpan | null {
  const days = daysInMonth(month);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const lastNight = addDays(stay.checkoutDate, -1);
  if (lastNight < first || stay.checkInDate > last) return null;
  const startDate = stay.checkInDate < first ? first : stay.checkInDate;
  const endDate = lastNight > last ? last : lastNight;
  return {
    start: Number(startDate.slice(8, 10)),
    end: Number(endDate.slice(8, 10)),
    cutStart: stay.checkInDate < first,
    cutEnd: lastNight > last,
  };
}

export interface AgendaDay {
  date: string;
  arrivals: CalendarStay[];
  staying: CalendarStay[];
  departures: CalendarStay[];
}

/** The month's days that have arrivals, departures, or stays in progress, in order. */
export function agenda(stays: readonly CalendarStay[], month: Month): AgendaDay[] {
  return daysInMonth(month)
    .map((date) => ({
      date,
      arrivals: stays.filter((stay) => stay.checkInDate === date),
      departures: stays.filter((stay) => stay.checkoutDate === date),
      staying: stays.filter((stay) => stay.checkInDate < date && stay.checkoutDate > date),
    }))
    .filter((day) => day.arrivals.length + day.departures.length + day.staying.length > 0);
}

/** The month's stays on one day (nights only), for the property month grid. */
export function staysOn(stays: readonly CalendarStay[], date: string): CalendarStay[] {
  return stays.filter((stay) => stay.checkInDate <= date && stay.checkoutDate > date);
}

const FILTERS_KEY = "guidesk.calendar.filters";

export interface CalendarFilters {
  propertyId: string;
  channel: string;
  cancelled: boolean;
}

export const DEFAULT_FILTERS: CalendarFilters = { propertyId: "", channel: "", cancelled: false };

/** The member's filters on this device (FR-006); storage may be blocked. */
export function loadFilters(): CalendarFilters {
  try {
    const raw = window.localStorage.getItem(FILTERS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<CalendarFilters>;
    return {
      propertyId: typeof parsed.propertyId === "string" ? parsed.propertyId : "",
      channel: typeof parsed.channel === "string" ? parsed.channel : "",
      cancelled: parsed.cancelled === true,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilters(filters: CalendarFilters): void {
  try {
    window.localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Blocked storage: the filters reset on the next visit, which is harmless.
  }
}
