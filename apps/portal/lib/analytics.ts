import type { PeriodCount } from "@guidesk/contracts";

/**
 * Analytics helpers for the portal (feature 010). Kept here instead of importing values from
 * `@guidesk/contracts` or `@guidesk/domain`, so the screens stay within the route budget.
 */
export const PERIODS = ["7", "30", "90"] as const;
export type PeriodValue = (typeof PERIODS)[number];

/** A share, or null when there is nothing to divide by (FR-015). */
export const rate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : numerator / denominator;

export interface Formatters {
  number: (value: number) => string;
  percent: (value: number) => string;
  dateTime: (iso: string) => string;
}

export function formatters(locale: string): Formatters {
  const tag = locale === "en" ? "en-US" : "es-CR";
  const number = new Intl.NumberFormat(tag);
  const percent = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 0 });
  const dateTime = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });
  return {
    number: (value) => number.format(value),
    percent: (value) => percent.format(value),
    dateTime: (iso) => dateTime.format(new Date(iso)),
  };
}

export const sum = (a: PeriodCount, b: PeriodCount): PeriodCount => ({
  current: a.current + b.current,
  previous: a.previous + b.previous,
});
