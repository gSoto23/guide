import { describe, expect, it } from "vitest";
import {
  classifyFeedEntry,
  detectChannel,
  feedDisplayHint,
  normalizeFeedUrl,
} from "../../src/properties/feeds.js";

describe("feed entry classification (FR-022, R8)", () => {
  it.each(["Reserved", "Reservado", "Airbnb (Reserved)", "RESERVADO", "Reservation HMAB12CD34"])(
    "treats %s as a reservation",
    (summary) => expect(classifyFeedEntry({ summary })).toBe("reservation"),
  );

  it("treats a summary with a booking reference as a reservation", () => {
    expect(classifyFeedEntry({ summary: "Ana F. - HMXY98ZW76" })).toBe("reservation");
    expect(classifyFeedEntry({ summary: "Booking 4123456789" })).toBe("reservation");
  });

  it.each([
    "Not available",
    "Blocked",
    "No disponible",
    "Bloqueado",
    "Airbnb (Not available)",
    "BLOCKED",
  ])("treats %s as a block", (summary) => expect(classifyFeedEntry({ summary })).toBe("block"));

  it("treats anything else as unlabeled", () => {
    expect(classifyFeedEntry({ summary: "CLOSED - Not available" })).toBe("unlabeled");
    expect(classifyFeedEntry({ summary: "" })).toBe("unlabeled");
    expect(classifyFeedEntry({})).toBe("unlabeled");
    expect(classifyFeedEntry({ summary: "Limpieza" })).toBe("unlabeled");
  });
});

describe("channel detection from the link's host (FR-020)", () => {
  it.each([
    ["https://www.airbnb.com/calendar/ical/123.ics?s=abc", "airbnb"],
    ["https://www.airbnb.es/calendar/ical/123.ics?s=abc", "airbnb"],
    ["https://www.airbnb.com.mx/calendar/ical/123.ics", "airbnb"],
    ["https://admin.booking.com/hotel/hoteladmin/ical.html?t=abc", "booking"],
    ["https://ical.booking.com/v1/export?t=abc", "booking"],
    ["https://www.vrbo.com/icalendar/abc.ics", "vrbo"],
    ["https://calendar.example.test/feed.ics", "other"],
    ["https://notairbnb.example.test/feed.ics", "other"],
  ])("%s → %s", (url, channel) => expect(detectChannel(url)).toBe(channel));
});

describe("link normalization for the fingerprint (FR-020)", () => {
  it("lowercases the scheme and host, drops the default port and fragment, keeps path and query", () => {
    expect(normalizeFeedUrl(" HTTPS://WWW.Airbnb.COM:443/calendar/ical/123.ics?s=AbC#frag ")).toBe(
      "https://www.airbnb.com/calendar/ical/123.ics?s=AbC",
    );
  });

  it("returns null for anything that is not an absolute URL", () => {
    expect(normalizeFeedUrl("not a url")).toBeNull();
  });
});

describe("the masked hint shown after saving (FR-025)", () => {
  it("shows the host and the end of the file name, never the query", () => {
    expect(
      feedDisplayHint("https://www.airbnb.com/calendar/ical/1234567a1b2.ics?s=secret-token"),
    ).toBe("airbnb.com/…/a1b2.ics");
    expect(feedDisplayHint("https://admin.booking.com/hotel/hoteladmin/ical.html?t=secret")).toBe(
      "admin.booking.com/…/ical.html",
    );
    expect(feedDisplayHint("https://calendar.example.test/?t=secret")).toBe(
      "calendar.example.test/…",
    );
  });
});

describe("Airbnb reservation codes (feature 018 FR-017)", () => {
  it("finds the code in the link or the description, and nothing else", async () => {
    const { airbnbReservationCode } = await import("../../src/properties/feeds.js");
    expect(
      airbnbReservationCode("https://www.airbnb.com/hosting/reservations/details/HMXYZ12345", null),
    ).toBe("HMXYZ12345");
    expect(
      airbnbReservationCode(null, "Reservation URL: https://x.test/d/HM1234ABCD\nPhone Number (Last 4 Digits): 4321"),
    ).toBe("HM1234ABCD");
    expect(airbnbReservationCode(null, "Phone Number (Last 4 Digits): 4321")).toBeNull();
    expect(airbnbReservationCode("HMSHORT", "123456789012")).toBeNull();
    expect(airbnbReservationCode(undefined)).toBeNull();
  });
});

