/**
 * Dates in the reader's language (feature 017 FR-013, research R5). Stay dates and requested dates
 * arrive as calendar dates (`YYYY-MM-DD`); they are read in UTC and formatted in UTC so that no time
 * zone moves them to the previous or next day.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAY: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
};

function calendarDate(value: string): Date | null {
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "26 sept 2026" (es), "Sep 26, 2026" (en). Returns the input when it is not a calendar date. */
export function formatDay(value: string, locale: string): string {
  const date = calendarDate(value);
  if (!date) return value;
  // Spanish adds a period to abbreviated months ("sept."); the period reads as noise in a list.
  return new Intl.DateTimeFormat(locale, DAY).format(date).replace(/\.(?= |$)/g, "");
}

/** A calendar date with an optional `HH:MM` time: "Sep 26, 2026, 10:00". */
export function formatDateTime(value: string, time: string | undefined | null, locale: string) {
  const day = formatDay(value, locale);
  return time ? `${day}, ${time}` : day;
}

/** "18–22 nov 2026", "28 nov – 2 dic 2026", "28 dic 2026 – 2 ene 2027". */
export function formatRange(from: string, to: string, locale: string): string {
  const start = calendarDate(from);
  const end = calendarDate(to);
  if (!start || !end) return `${from} → ${to}`;
  const format = new Intl.DateTimeFormat(locale, DAY);
  const text =
    typeof format.formatRange === "function"
      ? format.formatRange(start, end)
      : `${format.format(start)} – ${format.format(end)}`;
  return text.replace(/\.(?= |$)/g, "");
}
