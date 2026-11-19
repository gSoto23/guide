/**
 * The public catalogs are plain JSON with a few placeholders (feature 014 research R2):
 * `{company}`, `{email}`, `{date}`, `{year}`, `{count}`, and `{percent}`.
 */
export type Values = Partial<Record<string, string>>;

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

/** The text with each known placeholder replaced; unknown ones stay as written. */
export function fill(text: string, values: Values): string {
  return text.replace(PLACEHOLDER, (match, key: string) => values[key] ?? match);
}

/** Whether every placeholder in the text has a value (lines that need a missing one drop out). */
export function complete(text: string, values: Values): boolean {
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (values[match[1] ?? ""] === undefined) return false;
  }
  return true;
}

/** The lines that can be shown with these values, filled. */
export function usableLines(lines: readonly string[] | undefined, values: Values): string[] {
  return (lines ?? []).filter((line) => complete(line, values)).map((line) => fill(line, values));
}
