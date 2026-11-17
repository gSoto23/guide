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

/** A reservation read from a PMS, already reduced to what Guidesk keeps (AC-SEC-012). */
export interface PmsReservationInput {
  externalUid: string;
  listingExternalId: string;
  status: "active" | "cancelled";
  checkInDate: string;
  checkoutDate: string;
  guestCount: number | null;
  guestName: string | null;
  bookingReference: string | null;
  channel: string;
}

/** A stay that came from this PMS connection before. */
export interface PmsStay {
  id: string;
  externalUid: string;
  propertyId: string;
  status: "active" | "cancelled" | "hidden";
  checkInDate: string;
  checkoutDate: string;
  guestCount: number | null;
  guestName: string | null;
  /** The guest's name was removed on request: it never comes back (FR-053). */
  guestNameRemoved: boolean;
  bookingReference: string | null;
  channel: string;
}

export interface PmsStayChange {
  checkInDate: string;
  checkoutDate: string;
  guestCount: number | null;
  /** Undefined keeps the stored value: a name removed on request is never written again. */
  guestName?: string | null;
  bookingReference: string | null;
  channel: string;
}

export interface PmsStayPlan {
  create: (PmsStayChange & { externalUid: string; propertyId: string })[];
  update: (PmsStayChange & { id: string; status: "active" })[];
  /** IDs of stays cancelled in the PMS, or gone from a full read (FR-023, FR-034). */
  cancel: string[];
}

/**
 * What a PMS read changes in a connection's stays (FR-030, FR-034, FR-053). Reservations of
 * listings that were not imported, and past ones, are ignored. A cancelled reservation cancels
 * its stay. In a full read (every reservation with checkout in the window), upcoming stays the
 * PMS no longer returns are cancelled; an incremental read (`modifiedSince`) only applies what it
 * returns. Manual and feed stays are never part of `existing`, so a refresh cannot touch them.
 */
export function planPmsStays(input: {
  today: string;
  /** Imported listings of this connection: PMS listing ID → property. */
  propertyByListing: ReadonlyMap<string, string>;
  existing: readonly PmsStay[];
  reservations: readonly PmsReservationInput[];
  fullRead: boolean;
}): PmsStayPlan {
  const plan: PmsStayPlan = { create: [], update: [], cancel: [] };
  const byUid = new Map(input.existing.map((stay) => [stay.externalUid, stay]));
  const seen = new Set<string>();
  for (const reservation of input.reservations) {
    const propertyId = input.propertyByListing.get(reservation.listingExternalId);
    if (!propertyId) continue;
    if (reservation.checkoutDate <= reservation.checkInDate) continue;
    seen.add(reservation.externalUid);
    const current = byUid.get(reservation.externalUid);
    if (reservation.status === "cancelled") {
      if (current && current.status === "active") plan.cancel.push(current.id);
      continue;
    }
    if (reservation.checkoutDate < input.today) continue;
    const change: PmsStayChange = {
      checkInDate: reservation.checkInDate,
      checkoutDate: reservation.checkoutDate,
      guestCount: reservation.guestCount,
      bookingReference: reservation.bookingReference,
      channel: reservation.channel.slice(0, 40) || "PMS",
    };
    if (!current) {
      plan.create.push({
        ...change,
        guestName: reservation.guestName,
        externalUid: reservation.externalUid,
        propertyId,
      });
      continue;
    }
    const guestName = current.guestNameRemoved ? undefined : reservation.guestName;
    const changed =
      current.status !== "active" ||
      current.checkInDate !== change.checkInDate ||
      current.checkoutDate !== change.checkoutDate ||
      current.guestCount !== change.guestCount ||
      current.bookingReference !== change.bookingReference ||
      current.channel !== change.channel ||
      (guestName !== undefined && current.guestName !== guestName);
    // A hidden stay stays hidden; PMS stays are never "may be a block", so this is rare.
    if (changed && current.status !== "hidden") {
      plan.update.push({
        ...change,
        ...(guestName !== undefined ? { guestName } : {}),
        id: current.id,
        status: "active",
      });
    }
  }
  if (input.fullRead) {
    for (const stay of input.existing) {
      if (
        stay.status === "active" &&
        stay.checkoutDate >= input.today &&
        !seen.has(stay.externalUid)
      ) {
        plan.cancel.push(stay.id);
      }
    }
  }
  return plan;
}
