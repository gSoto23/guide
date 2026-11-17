import type { FeedEntryKind } from "./feeds.js";

/**
 * Stay rules (feature 002 FR-022, FR-023, FR-052 to FR-054, data model §3): applying a feed read,
 * deduplication across sources, overlaps, and "upcoming" in the property's time zone. Dates are
 * calendar dates (`YYYY-MM-DD`) in the property's zone.
 */
export interface FeedEntry {
  uid: string;
  start: string;
  end: string;
  kind: FeedEntryKind;
}

/** A stay that came from this feed before. */
export interface FeedStay {
  id: string;
  externalUid: string;
  checkInDate: string;
  checkoutDate: string;
  status: "active" | "cancelled" | "hidden";
  mayBeBlock: boolean;
}

export interface FeedRefreshPlan {
  create: { externalUid: string; checkInDate: string; checkoutDate: string; mayBeBlock: boolean }[];
  update: {
    id: string;
    checkInDate: string;
    checkoutDate: string;
    mayBeBlock: boolean;
    status: "active";
  }[];
  /** IDs of stays that disappeared from the feed (FR-023). */
  cancel: string[];
}

/**
 * What a successful read changes in this feed's stays. Past entries are ignored; blocks never
 * become stays; entries missing from the read are cancelled; hidden stays stay hidden (FR-022).
 * Manual and PMS stays are never part of `existing`, so a refresh cannot touch them (FR-053).
 */
export function planFeedRefresh(input: {
  today: string;
  existing: FeedStay[];
  entries: FeedEntry[];
}): FeedRefreshPlan {
  const plan: FeedRefreshPlan = { create: [], update: [], cancel: [] };
  const byUid = new Map(input.existing.map((stay) => [stay.externalUid, stay]));
  const seen = new Set<string>();
  for (const entry of input.entries) {
    if (entry.kind === "block" || entry.end < input.today || entry.end <= entry.start) continue;
    seen.add(entry.uid);
    const mayBeBlock = entry.kind === "unlabeled";
    const current = byUid.get(entry.uid);
    if (!current) {
      plan.create.push({
        externalUid: entry.uid,
        checkInDate: entry.start,
        checkoutDate: entry.end,
        mayBeBlock,
      });
      continue;
    }
    if (current.status === "hidden") continue;
    const changed =
      current.status === "cancelled" ||
      current.checkInDate !== entry.start ||
      current.checkoutDate !== entry.end ||
      current.mayBeBlock !== mayBeBlock;
    if (changed) {
      plan.update.push({
        id: current.id,
        checkInDate: entry.start,
        checkoutDate: entry.end,
        mayBeBlock,
        status: "active",
      });
    }
  }
  for (const stay of input.existing) {
    if (seen.has(stay.externalUid) || stay.status === "cancelled") continue;
    // Past stays are no longer in the feed; leave them as they were.
    if (stay.checkoutDate < input.today) continue;
    plan.cancel.push(stay.id);
  }
  return plan;
}

export interface VisibleStay {
  id: string;
  source: "ical" | "pms" | "manual";
  calendarFeedId: string | null;
  checkInDate: string;
  checkoutDate: string;
  mayBeBlock: boolean;
  status: "active" | "cancelled" | "hidden";
  duplicateOfId: string | null;
}

/**
 * Duplicate marks for a property's active stays (edge cases): a PMS stay wins over a feed stay
 * with the same dates, and an unlabeled feed entry matching a labeled reservation from another
 * feed is a duplicate of it. Returns only the marks that change. Manual stays are never marked.
 */
export function markDuplicates(
  stays: VisibleStay[],
): { id: string; duplicateOfId: string | null }[] {
  const active = stays.filter((stay) => stay.status === "active");
  const key = (stay: VisibleStay) => `${stay.checkInDate}|${stay.checkoutDate}`;
  const pmsByDates = new Map<string, string>();
  const labeledByDates = new Map<string, VisibleStay[]>();
  for (const stay of active) {
    if (stay.source === "pms" && !pmsByDates.has(key(stay))) pmsByDates.set(key(stay), stay.id);
    if (stay.source === "ical" && !stay.mayBeBlock) {
      labeledByDates.set(key(stay), [...(labeledByDates.get(key(stay)) ?? []), stay]);
    }
  }
  const changes: { id: string; duplicateOfId: string | null }[] = [];
  for (const stay of stays) {
    if (stay.source !== "ical") continue;
    let duplicateOfId: string | null = null;
    if (stay.status === "active") {
      duplicateOfId = pmsByDates.get(key(stay)) ?? null;
      if (!duplicateOfId && stay.mayBeBlock) {
        const labeled = labeledByDates
          .get(key(stay))
          ?.find((other) => other.calendarFeedId !== stay.calendarFeedId);
        duplicateOfId = labeled?.id ?? null;
      }
    }
    if (duplicateOfId !== stay.duplicateOfId) changes.push({ id: stay.id, duplicateOfId });
  }
  return changes;
}

/** IDs of stays that overlap another; checking out the day the next guest checks in is fine. */
export function flagOverlaps(
  stays: { id: string; checkInDate: string; checkoutDate: string }[],
): Set<string> {
  const sorted = [...stays].sort((a, b) => (a.checkInDate < b.checkInDate ? -1 : 1));
  const overlapping = new Set<string>();
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (b.checkInDate >= a.checkoutDate) break;
      overlapping.add(a.id);
      overlapping.add(b.id);
    }
  }
  return overlapping;
}

/** Today's date in the property's time zone (FR-005). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "Upcoming" in the spec: active, with checkout today or later in the property's zone. */
export function isUpcoming(stay: { status: string; checkoutDate: string }, today: string): boolean {
  return stay.status === "active" && stay.checkoutDate >= today;
}
