/**
 * The legal pages' last update (feature 014 FR-008). Change it whenever the privacy policy or the
 * terms change; the legal review (OQ-35) will set the next one.
 */
export const LEGAL_UPDATED = "2026-11-19";

/** The date in the reader's language, for example "19 de noviembre de 2026". */
export function legalDate(locale: string, iso: string = LEGAL_UPDATED): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}
