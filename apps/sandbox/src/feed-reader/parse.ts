import { createHash } from "node:crypto";
import ICAL from "ical.js";
import { classifyFeedEntry } from "@guidesk/domain";
import type { FeedEntry } from "../protocol.js";

/** At most this many entries leave the function (the protocol's limit). */
export const MAX_ENTRIES = 5000;

function dateOf(value: unknown): string | null {
  if (!(value instanceof ICAL.Time)) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`;
}

/** Keeps UIDs within the protocol's 255 characters while staying stable across reads. */
function stableUid(uid: string): string {
  return uid.length <= 255 ? uid : `sha256:${createHash("sha256").update(uid).digest("hex")}`;
}

/**
 * Parses an iCal body into entries (research R8, FR-022). Only VEVENTs with a UID, DTSTART, and
 * DTEND are kept, past entries are dropped, and each is classified with the domain's table. The
 * output carries `{uid, start, end, kind}` and nothing else: summaries, descriptions, reservation
 * links, and phone digits never leave the function. Returns null when the body is not iCal.
 */
export function parseFeed(body: Buffer, today: string): FeedEntry[] | null {
  let calendar: ICAL.Component;
  try {
    const text = body.toString("utf8");
    if (!/BEGIN:VCALENDAR/i.test(text)) return null;
    calendar = new ICAL.Component(ICAL.parse(text) as unknown[]);
  } catch {
    return null;
  }
  if (calendar.name !== "vcalendar") return null;
  const entries: FeedEntry[] = [];
  for (const event of calendar.getAllSubcomponents("vevent")) {
    const uid = event.getFirstPropertyValue("uid");
    const start = dateOf(event.getFirstPropertyValue("dtstart"));
    const end = dateOf(event.getFirstPropertyValue("dtend"));
    if (typeof uid !== "string" || !uid || !start || !end || end <= start || end < today) continue;
    const summary = event.getFirstPropertyValue("summary");
    entries.push({
      uid: stableUid(uid),
      start,
      end,
      kind: classifyFeedEntry({ summary: typeof summary === "string" ? summary : null }),
    });
    if (entries.length >= MAX_ENTRIES) break;
  }
  return entries;
}
