/**
 * The stay window (feature 004 FR-027, research R6): from 00:00 on the check-in day to 2 hours
 * after the checkout time on the checkout day, in the property's time zone. Computed from the stay
 * on every request, so date changes, cancellations, and revocations apply at once.
 */

export const CHECKOUT_BUFFER_MINUTES = 120;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

export interface WindowStay {
  checkInDate: string;
  checkoutDate: string;
  /** Null uses the property's time (spec 002 FR-052). */
  checkInTime: string | null;
  checkoutTime: string | null;
}

export interface WindowProperty {
  timeZone: string;
  checkInTime: string | null;
  checkoutTime: string | null;
}

export interface StayWindow {
  opensAt: Date;
  closesAt: Date;
  /** "HH:MM" as shown to guests, or null when neither the stay nor the property has one. */
  checkInTime: string | null;
  checkoutTime: string | null;
}

function hhmm(time: string | null): string | null {
  if (time === null) return null;
  const match = TIME_PATTERN.exec(time);
  if (!match) throw new Error(`Invalid time: ${time}`);
  return `${match[1]}:${match[2]}`;
}

/** Milliseconds the zone's wall clock is ahead of UTC at `instant`. */
function offsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant of a wall-clock date and time in a zone, correct across daylight saving changes. */
export function zonedTimeToInstant(date: string, time: string, timeZone: string): Date {
  const day = DATE_PATTERN.exec(date);
  const clock = TIME_PATTERN.exec(time);
  if (!day || !clock) throw new Error(`Invalid local date or time: ${date} ${time}`);
  const guess = Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
  );
  const first = offsetAt(guess, timeZone);
  const candidate = guess - first;
  const second = offsetAt(candidate, timeZone);
  return new Date(second === first ? candidate : guess - second);
}

export function stayWindow(stay: WindowStay, property: WindowProperty): StayWindow {
  const checkInTime = hhmm(stay.checkInTime ?? property.checkInTime);
  const checkoutTime = hhmm(stay.checkoutTime ?? property.checkoutTime);
  const opensAt = zonedTimeToInstant(stay.checkInDate, "00:00", property.timeZone);
  // Without a checkout time (never for a published guide), the window runs to the end of the day.
  const checkout = zonedTimeToInstant(
    stay.checkoutDate,
    checkoutTime ?? "23:59",
    property.timeZone,
  );
  return {
    opensAt,
    closesAt: new Date(checkout.getTime() + CHECKOUT_BUFFER_MINUTES * 60_000),
    checkInTime,
    checkoutTime,
  };
}
