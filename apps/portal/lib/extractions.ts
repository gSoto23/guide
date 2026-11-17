/**
 * Helpers for listing extraction in the portal (US2, T062): uploads through the presigned forms
 * the API returns, and the notice of removed codes.
 */
import type { CreatedExtraction, ExtractedItem } from "@guidesk/contracts";

export const MAX_TEXT = 20_000;
export const MAX_SCREENSHOTS = 10;
export const POLL_MS = 1500;
/** The job has 60 seconds (FR-016); past this, the page says it is slow. */
export const SLOW_AFTER_MS = 75_000;

/**
 * Posts one screenshot to its presigned form: the signed fields first, the file last, as S3
 * requires. A failed upload is not fatal: the job counts it as a screenshot it could not read,
 * and the host is offered to paste the text instead.
 */
export async function uploadScreenshot(
  form: CreatedExtraction["uploads"][number],
  blob: Blob,
  signal?: AbortSignal,
): Promise<boolean> {
  const body = new FormData();
  for (const [name, value] of Object.entries(form.fields)) body.append(name, value);
  body.append("file", blob, "screenshot.jpg");
  try {
    const response = await fetch(form.url, { method: "POST", body, signal });
    return response.ok;
  } catch {
    return false;
  }
}

/** Kinds of removed values, in the order the notice lists them. */
export const REDACTION_KINDS = [
  "door_code",
  "gate_code",
  "lockbox_code",
  "alarm_code",
  "wifi_password",
  "other",
] as const;

/**
 * "2 door codes and 1 Wi-Fi password": one message per kind, joined the way the locale joins a
 * list. Empty when nothing was removed.
 */
export function redactionList(
  redactions: Record<string, number>,
  locale: string,
  label: (kind: (typeof REDACTION_KINDS)[number], count: number) => string,
): string {
  const parts = REDACTION_KINDS.filter((kind) => (redactions[kind] ?? 0) > 0).map((kind) =>
    label(kind, redactions[kind]!),
  );
  return parts.length ? new Intl.ListFormat(locale, { type: "conjunction" }).format(parts) : "";
}

/** An extracted item while the host reviews it. */
export interface ReviewItem {
  kind: ExtractedItem["kind"];
  /** The body, or the amenities one per line. */
  text: string;
  language: string | null;
  containsLink: boolean;
  keep: boolean;
  edited: boolean;
}

export function toReviewItem(item: ExtractedItem): ReviewItem {
  return {
    kind: item.kind,
    text: item.kind === "amenities" ? (item.items ?? []).join("\n") : (item.body ?? ""),
    language: item.language,
    containsLink: item.containsLink,
    keep: true,
    edited: false,
  };
}

/** What `POST /properties` accepts for one kept item. */
export function toContentItem(item: ReviewItem) {
  const base = { kind: item.kind, language: item.language, edited: item.edited };
  if (item.kind === "amenities") {
    const items = item.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(0, 120));
    return { ...base, items };
  }
  return { ...base, body: item.text.trim() };
}

/** A kept item with nothing left in it is dropped rather than refused. */
export function isEmpty(item: ReviewItem): boolean {
  return item.text.trim() === "";
}

/** "15:00" from the model's "15:00" or "15:00:00"; anything else is dropped. */
export function toTimeValue(value: string | null): string | undefined {
  const match = value?.match(/^([01]\d|2[0-3]):([0-5]\d)/);
  return match ? `${match[1]}:${match[2]}` : undefined;
}

/** When the daily extraction limit resets, in the host's locale and time zone (FR-017). */
export function formatResetTime(resetsAt: string | undefined, locale: string): string {
  const date = resetsAt ? new Date(resetsAt) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
