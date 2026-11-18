import { zonedTimeToInstant } from "../guest/window.js";
import { todayIn } from "../properties/stays.js";

/**
 * Extras and add-on requests (feature 008): the catalog's values and the request rules (research R1,
 * R2). Pure functions: the API checks a request with them, the worker computes expiry with them.
 */
export const EXTRA_CURRENCIES = ["USD", "CRC", "MXN", "EUR", "COP", "GTQ"] as const;
export type ExtraCurrency = (typeof EXTRA_CURRENCIES)[number];
export const EXTRA_DATE_RANGES = ["stay", "before_arrival"] as const;
export type ExtraDateRange = (typeof EXTRA_DATE_RANGES)[number];
export const EXTRA_TURNOVERS = ["early_check_in", "late_checkout"] as const;
export type ExtraTurnover = (typeof EXTRA_TURNOVERS)[number];
export const SERVICE_REQUEST_STATUSES = [
  "waiting",
  "confirmed",
  "declined",
  "cancelled",
  "host_cancelled",
  "expired",
] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];
export const SERVICE_REQUEST_REASONS = [
  "unavailable",
  "fully_booked",
  "too_late",
  "other",
] as const;
export type ServiceRequestReason = (typeof SERVICE_REQUEST_REASONS)[number];
/** Suggested extras the empty catalog offers as prefilled forms (FR-004). */
export const EXTRA_SUGGESTIONS = [
  "airport_pickup",
  "extra_cleaning",
  "grocery_stocking",
  "late_checkout",
] as const;

/** Pilot values to tune (spec assumptions). */
export const EXTRA_LIMITS = {
  nameMax: 80,
  descriptionMax: 500,
  priceMax: 100_000,
  leadTimeHoursMax: 720,
  maxPerStay: 10,
  noteMax: 300,
  reasonTextMax: 200,
  waitingPerStay: 10,
  createdPerStayPerDay: 20,
  duplicateSeconds: 60,
  noDateExpiryHours: 48,
} as const;

export interface ExtraRules {
  leadTimeHours: number;
  /** ISO weekdays, 1 (Monday) to 7 (Sunday). */
  weekdays: readonly number[];
  needsDate: boolean;
  needsTime: boolean;
  dateRange: ExtraDateRange;
  maxPerStay: number;
  preApproved: boolean;
  turnover: ExtraTurnover | null;
}

export interface RequestInput {
  date?: string | null;
  time?: string | null;
  quantity: number;
}

export interface RequestContext {
  stay: { checkInDate: string; checkoutDate: string };
  timeZone: string;
  now: Date;
  /** Quantity of this extra already waiting or confirmed for the stay. */
  usedQuantity: number;
  /** The property's other active stays, for the turnover rule. */
  otherStays: readonly { checkInDate: string; checkoutDate: string }[];
}

export type RequestRule =
  | "quantity"
  | "needs_date"
  | "needs_time"
  | "date_range"
  | "weekday"
  | "lead_time"
  | "max_per_stay"
  | "turnover";

export type RequestCheck =
  | {
      ok: true;
      date: string | null;
      time: string | null;
      expiresAt: Date;
      status: "waiting" | "confirmed";
    }
  | { ok: false; rule: RequestRule };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HOUR_MS = 3_600_000;

/** ISO weekday (1 = Monday) of a calendar date. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Checks a request against an extra's rules (FR-010, research R2) and returns the first rule that
 * fails, or the stored date and time, the expiry, and the status (pre-approved ones are confirmed).
 */
export function checkRequest(
  rules: ExtraRules,
  input: RequestInput,
  context: RequestContext,
): RequestCheck {
  const quantity = input.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > EXTRA_LIMITS.maxPerStay) {
    return { ok: false, rule: "quantity" };
  }
  let date: string | null = null;
  let time: string | null = null;
  if (rules.turnover) {
    // Early check-in and late checkout are on the stay's own dates.
    date =
      rules.turnover === "early_check_in" ? context.stay.checkInDate : context.stay.checkoutDate;
  } else if (rules.needsDate) {
    if (!input.date || !validDate(input.date)) return { ok: false, rule: "needs_date" };
    date = input.date;
  }
  if (rules.needsTime && (rules.needsDate || rules.turnover)) {
    if (!input.time || !TIME.test(input.time)) return { ok: false, rule: "needs_time" };
    time = input.time;
  }
  const today = todayIn(context.timeZone, context.now);
  if (date && !rules.turnover) {
    const [from, to] =
      rules.dateRange === "before_arrival"
        ? [today, context.stay.checkInDate]
        : [context.stay.checkInDate, context.stay.checkoutDate];
    if (date < from || date > to || date < today) return { ok: false, rule: "date_range" };
  }
  if (date && !rules.weekdays.includes(isoWeekday(date))) return { ok: false, rule: "weekday" };
  const moment = date ? zonedTimeToInstant(date, time ?? "00:00", context.timeZone) : null;
  if (moment && moment.getTime() - rules.leadTimeHours * HOUR_MS < context.now.getTime()) {
    return { ok: false, rule: "lead_time" };
  }
  if (context.usedQuantity + quantity > rules.maxPerStay)
    return { ok: false, rule: "max_per_stay" };
  if (rules.turnover === "early_check_in") {
    if (context.otherStays.some((other) => other.checkoutDate === context.stay.checkInDate)) {
      return { ok: false, rule: "turnover" };
    }
  } else if (rules.turnover === "late_checkout") {
    if (context.otherStays.some((other) => other.checkInDate === context.stay.checkoutDate)) {
      return { ok: false, rule: "turnover" };
    }
  }
  const expiresAt = moment
    ? new Date(moment.getTime() - rules.leadTimeHours * HOUR_MS)
    : new Date(context.now.getTime() + EXTRA_LIMITS.noDateExpiryHours * HOUR_MS);
  return {
    ok: true,
    date,
    time,
    expiresAt,
    status: rules.preApproved ? "confirmed" : "waiting",
  };
}

/** Which status changes a member or guest may make (data model transitions). */
export function canTransition(from: ServiceRequestStatus, to: ServiceRequestStatus): boolean {
  if (from === "waiting") return ["confirmed", "declined", "cancelled", "expired"].includes(to);
  if (from === "confirmed") return to === "host_cancelled";
  return false;
}

/** The text in the language asked, else the source language (FR-006). */
export function localized(
  value: Partial<Record<"es" | "en", string>>,
  language: "es" | "en",
  source: "es" | "en",
): { text: string; language: "es" | "en" } {
  const asked = value[language];
  if (asked) return { text: asked, language };
  return { text: value[source] ?? value.es ?? value.en ?? "", language: source };
}
