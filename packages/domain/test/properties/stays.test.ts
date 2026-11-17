import { describe, expect, it } from "vitest";
import {
  planPmsStays,
  type PmsReservationInput,
  type PmsStay,
  flagOverlaps,
  isUpcoming,
  markDuplicates,
  planFeedRefresh,
  todayIn,
  type FeedStay,
  type VisibleStay,
} from "../../src/properties/stays.js";

const today = "2027-01-10";

const existing = (overrides: Partial<FeedStay> & Pick<FeedStay, "externalUid">): FeedStay => ({
  id: `stay-${overrides.externalUid}`,
  checkInDate: "2027-01-20",
  checkoutDate: "2027-01-22",
  status: "active",
  mayBeBlock: false,
  ...overrides,
});

describe("applying a successful feed read (FR-022, FR-023)", () => {
  it("adds new upcoming entries, ignores blocks and past entries, and flags unlabeled ones", () => {
    const plan = planFeedRefresh({
      today,
      existing: [],
      entries: [
        { uid: "a", start: "2027-01-20", end: "2027-01-22", kind: "reservation" },
        { uid: "b", start: "2027-02-01", end: "2027-02-03", kind: "block" },
        { uid: "c", start: "2027-01-01", end: "2027-01-05", kind: "reservation" },
        { uid: "d", start: "2027-03-01", end: "2027-03-04", kind: "unlabeled" },
        { uid: "e", start: "2027-01-08", end: "2027-01-10", kind: "reservation" },
      ],
    });
    expect(plan.create).toEqual([
      {
        externalUid: "a",
        checkInDate: "2027-01-20",
        checkoutDate: "2027-01-22",
        mayBeBlock: false,
      },
      { externalUid: "d", checkInDate: "2027-03-01", checkoutDate: "2027-03-04", mayBeBlock: true },
      // Checking out today is still upcoming.
      {
        externalUid: "e",
        checkInDate: "2027-01-08",
        checkoutDate: "2027-01-10",
        mayBeBlock: false,
      },
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.cancel).toEqual([]);
  });

  it("marks entries missing from the read as cancelled, and updates changed dates", () => {
    const plan = planFeedRefresh({
      today,
      existing: [existing({ externalUid: "a" }), existing({ externalUid: "gone" })],
      entries: [{ uid: "a", start: "2027-01-21", end: "2027-01-23", kind: "reservation" }],
    });
    expect(plan.update).toEqual([
      {
        id: "stay-a",
        checkInDate: "2027-01-21",
        checkoutDate: "2027-01-23",
        mayBeBlock: false,
        status: "active",
      },
    ]);
    expect(plan.cancel).toEqual(["stay-gone"]);
  });

  it("keeps hidden stays hidden when they come back", () => {
    const plan = planFeedRefresh({
      today,
      existing: [existing({ externalUid: "d", status: "hidden", mayBeBlock: true })],
      entries: [{ uid: "d", start: "2027-01-20", end: "2027-01-22", kind: "unlabeled" }],
    });
    expect(plan.update).toEqual([]);
    expect(plan.cancel).toEqual([]);
    expect(plan.create).toEqual([]);
  });

  it("reactivates a cancelled stay that reappears, and does not cancel past stays again", () => {
    const plan = planFeedRefresh({
      today,
      existing: [
        existing({ externalUid: "back", status: "cancelled" }),
        existing({ externalUid: "past", checkInDate: "2027-01-01", checkoutDate: "2027-01-03" }),
      ],
      entries: [{ uid: "back", start: "2027-01-20", end: "2027-01-22", kind: "reservation" }],
    });
    expect(plan.update).toEqual([
      {
        id: "stay-back",
        checkInDate: "2027-01-20",
        checkoutDate: "2027-01-22",
        mayBeBlock: false,
        status: "active",
      },
    ]);
    expect(plan.cancel).toEqual([]);
  });

  it("turns a stay that became a block into a cancelled stay", () => {
    const plan = planFeedRefresh({
      today,
      existing: [existing({ externalUid: "x" })],
      entries: [{ uid: "x", start: "2027-01-20", end: "2027-01-22", kind: "block" }],
    });
    expect(plan.cancel).toEqual(["stay-x"]);
  });
});

describe("deduplication across sources (edge cases)", () => {
  const stay = (overrides: Partial<VisibleStay> & Pick<VisibleStay, "id">): VisibleStay => ({
    source: "ical",
    calendarFeedId: "feed-1",
    checkInDate: "2027-01-20",
    checkoutDate: "2027-01-22",
    mayBeBlock: false,
    status: "active",
    duplicateOfId: null,
    ...overrides,
  });

  it("lets a PMS stay win over a feed stay with the same property and dates", () => {
    const result = markDuplicates([
      stay({ id: "feed" }),
      stay({ id: "pms", source: "pms", calendarFeedId: null }),
    ]);
    expect(result).toEqual([{ id: "feed", duplicateOfId: "pms" }]);
  });

  it("marks an unlabeled entry matching a labeled reservation from another feed", () => {
    const result = markDuplicates([
      stay({ id: "labeled", calendarFeedId: "feed-airbnb" }),
      stay({ id: "unlabeled", calendarFeedId: "feed-booking", mayBeBlock: true }),
    ]);
    expect(result).toEqual([{ id: "unlabeled", duplicateOfId: "labeled" }]);
  });

  it("never touches manual stays, and clears a duplicate mark that no longer applies", () => {
    const result = markDuplicates([
      stay({ id: "manual", source: "manual", calendarFeedId: null }),
      stay({ id: "feed", duplicateOfId: "old-pms" }),
    ]);
    expect(result).toEqual([{ id: "feed", duplicateOfId: null }]);
  });
});

describe("overlaps (FR-054)", () => {
  it("flags visible stays whose dates overlap; back-to-back stays do not overlap", () => {
    const stays = [
      { id: "a", checkInDate: "2027-01-10", checkoutDate: "2027-01-12" },
      { id: "b", checkInDate: "2027-01-11", checkoutDate: "2027-01-13" },
      { id: "c", checkInDate: "2027-01-13", checkoutDate: "2027-01-15" },
    ];
    expect(flagOverlaps(stays)).toEqual(new Set(["a", "b"]));
  });
});

describe("upcoming in the property's time zone (FR-005)", () => {
  it("computes today in the property's zone", () => {
    const now = new Date("2027-01-10T03:00:00Z");
    expect(todayIn("America/Costa_Rica", now)).toBe("2027-01-09");
    expect(todayIn("Europe/Madrid", now)).toBe("2027-01-10");
  });

  it("is an active stay whose checkout is today or later", () => {
    expect(isUpcoming({ status: "active", checkoutDate: "2027-01-10" }, "2027-01-10")).toBe(true);
    expect(isUpcoming({ status: "active", checkoutDate: "2027-01-09" }, "2027-01-10")).toBe(false);
    expect(isUpcoming({ status: "cancelled", checkoutDate: "2027-02-01" }, "2027-01-10")).toBe(
      false,
    );
  });
});

describe("applying a PMS read (FR-030, FR-034, FR-053)", () => {
  const today = "2026-12-01";
  const propertyByListing = new Map([
    ["101:201", "prop-a"],
    ["101:202", "prop-b"],
  ]);
  const reservation = (over: Partial<PmsReservationInput> = {}): PmsReservationInput => ({
    externalUid: "bk-1",
    listingExternalId: "101:201",
    status: "active",
    checkInDate: "2026-12-10",
    checkoutDate: "2026-12-14",
    guestCount: 3,
    guestName: "Ana Prueba",
    bookingReference: "bk-1",
    channel: "Airbnb",
    ...over,
  });
  const stored = (over: Partial<PmsStay> = {}): PmsStay => ({
    id: "stay-1",
    externalUid: "bk-1",
    propertyId: "prop-a",
    status: "active",
    checkInDate: "2026-12-10",
    checkoutDate: "2026-12-14",
    guestCount: 3,
    guestName: "Ana Prueba",
    guestNameRemoved: false,
    bookingReference: "bk-1",
    channel: "Airbnb",
    ...over,
  });

  it("creates stays for imported listings only, and skips past ones", () => {
    const plan = planPmsStays({
      today,
      propertyByListing,
      existing: [],
      fullRead: true,
      reservations: [
        reservation(),
        reservation({ externalUid: "bk-2", listingExternalId: "999:1" }),
        reservation({ externalUid: "bk-3", checkInDate: "2026-11-01", checkoutDate: "2026-11-05" }),
      ],
    });
    expect(plan.create).toEqual([
      expect.objectContaining({
        externalUid: "bk-1",
        propertyId: "prop-a",
        guestName: "Ana Prueba",
      }),
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.cancel).toEqual([]);
  });

  it("applies changed and cancelled reservations, and cancels what a full read no longer has", () => {
    const plan = planPmsStays({
      today,
      propertyByListing,
      fullRead: true,
      existing: [
        stored(),
        stored({ id: "stay-2", externalUid: "bk-2" }),
        stored({ id: "stay-3", externalUid: "bk-3" }),
      ],
      reservations: [
        reservation({ checkoutDate: "2026-12-15" }),
        reservation({ externalUid: "bk-2", status: "cancelled" }),
      ],
    });
    expect(plan.update).toEqual([
      expect.objectContaining({ id: "stay-1", checkoutDate: "2026-12-15", status: "active" }),
    ]);
    expect(plan.cancel.sort()).toEqual(["stay-2", "stay-3"]);
  });

  it("only applies what an incremental read returns", () => {
    const plan = planPmsStays({
      today,
      propertyByListing,
      fullRead: false,
      existing: [stored(), stored({ id: "stay-2", externalUid: "bk-2" })],
      reservations: [reservation({ guestCount: 4 })],
    });
    expect(plan.update.map((change) => change.id)).toEqual(["stay-1"]);
    expect(plan.cancel).toEqual([]);
  });

  it("never writes back a guest name removed on request, even when the PMS changes it", () => {
    const plan = planPmsStays({
      today,
      propertyByListing,
      fullRead: false,
      existing: [stored({ guestName: null, guestNameRemoved: true })],
      reservations: [reservation({ guestName: "Ana María Prueba" })],
    });
    expect(plan.update).toEqual([]);
    const changed = planPmsStays({
      today,
      propertyByListing,
      fullRead: false,
      existing: [stored({ guestName: null, guestNameRemoved: true })],
      reservations: [reservation({ guestName: "Ana María Prueba", guestCount: 5 })],
    });
    expect(changed.update).toHaveLength(1);
    expect(changed.update[0]).not.toHaveProperty("guestName");
  });
});
