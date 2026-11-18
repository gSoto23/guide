import { zonedTimeToInstant } from "../guest/window.js";
import type { QuietHours } from "./settings.js";

/**
 * Quiet hours (feature 007 research R6, FR-008): a daily window of local wall times in the
 * property's IANA zone. A window may cross midnight (22:00 to 07:00) or sit within a day (13:00 to
 * 15:00). Instants come from wall times, so daylight-saving changes follow the zone.
 */
export interface QuietWindow {
  active: boolean;
  /** When the current window ends; null when not active. */
  endsAt: Date | null;
  /** The window's end as `HH:MM` local time, for the holding reply (FR-009). */
  endsAtLocal: string | null;
}

const INACTIVE: QuietWindow = Object.freeze({ active: false, endsAt: null, endsAtLocal: null });

function minutes(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

function localParts(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** Whether quiet hours are on at `now`, and when they end. No zone or no hours: never active. */
export function quietWindow(
  now: Date,
  timeZone: string | null | undefined,
  hours: QuietHours | null | undefined,
): QuietWindow {
  if (!timeZone || !hours || hours.start === hours.end) return INACTIVE;
  let local: { date: string; minutes: number };
  try {
    local = localParts(now, timeZone);
  } catch {
    return INACTIVE;
  }
  const start = minutes(hours.start);
  const end = minutes(hours.end);
  let endDate: string;
  if (start < end) {
    if (local.minutes < start || local.minutes >= end) return INACTIVE;
    endDate = local.date;
  } else if (local.minutes >= start) {
    endDate = nextDay(local.date);
  } else if (local.minutes < end) {
    endDate = local.date;
  } else {
    return INACTIVE;
  }
  return {
    active: true,
    endsAt: zonedTimeToInstant(endDate, hours.end, timeZone),
    endsAtLocal: hours.end,
  };
}
