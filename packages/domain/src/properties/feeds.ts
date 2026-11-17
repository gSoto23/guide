/**
 * Calendar feed rules (feature 002 FR-020 to FR-026, research R8): entry classification, channel
 * detection, link normalization for the duplicate check, and the masked hint shown after saving.
 */
export const FEED_CHANNELS = ["airbnb", "booking", "vrbo", "other"] as const;
export type FeedChannel = (typeof FEED_CHANNELS)[number];

export const FEED_ENTRY_KINDS = ["reservation", "block", "unlabeled"] as const;
export type FeedEntryKind = (typeof FEED_ENTRY_KINDS)[number];

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Summaries that mean "blocked": the whole summary, optionally wrapped as "Airbnb (…)". */
const BLOCK_SUMMARIES = new Set(["not available", "blocked", "no disponible", "bloqueado"]);
const RESERVATION_SUMMARIES = new Set(["reserved", "reservado", "reservada", "booked"]);
const RESERVATION_WORDS = /\b(reserved|reservation|reservado|reservada|reserva|booked|booking)\b/;
/** Booking references: Airbnb confirmation codes (HM + 8) and 9–12 digit reservation numbers. */
const BOOKING_REFERENCE = /\bHM[A-Z0-9]{8}\b|\b\d{9,12}\b/;

/**
 * Classifies one iCal entry (FR-022). Reservations become stays, blocks never do, and anything
 * else becomes a stay marked "may be a block". The table errs toward "unlabeled": a host can hide
 * a stay, but a missed reservation would be invisible. The summary itself never leaves the feed
 * reader.
 */
export function classifyFeedEntry(entry: { summary?: string | null }): FeedEntryKind {
  const raw = entry.summary ?? "";
  const summary = fold(raw);
  if (!summary) return "unlabeled";
  const unwrapped = summary.replace(/^airbnb \((.*)\)$/, "$1").trim();
  if (BLOCK_SUMMARIES.has(unwrapped)) return "block";
  if (RESERVATION_SUMMARIES.has(unwrapped)) return "reservation";
  if (RESERVATION_WORDS.test(summary) || BOOKING_REFERENCE.test(raw)) return "reservation";
  return "unlabeled";
}

/** The channel a link belongs to, from its host; the host can change it (FR-020). */
export function detectChannel(url: string): FeedChannel {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return "other";
  }
  const labels = host.split(".");
  // airbnb.com, airbnb.es, airbnb.com.mx, …
  if (labels.includes("airbnb") && labels.indexOf("airbnb") >= labels.length - 3) return "airbnb";
  if (host === "booking.com" || host.endsWith(".booking.com")) return "booking";
  if (host === "vrbo.com" || host.endsWith(".vrbo.com")) return "vrbo";
  return "other";
}

/**
 * The link as compared for "same link twice" (FR-020): lowercase scheme and host, no default
 * port, no fragment. The path and query stay as they are, because feed tokens live there.
 */
export function normalizeFeedUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  parsed.hash = "";
  return parsed.toString();
}

/**
 * The masked form shown after saving (FR-025): the host without `www.`, then `…`, then the last
 * four characters of the file name and its extension. Never the query, which carries the token.
 */
export function feedDisplayHint(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "…";
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const file = parsed.pathname.split("/").filter(Boolean).at(-1);
  if (!file) return `${host}/…`;
  const dot = file.lastIndexOf(".");
  const base = dot > 0 ? file.slice(0, dot) : file;
  const extension = dot > 0 ? file.slice(dot) : "";
  return `${host}/…/${base.slice(-4)}${extension}`;
}
