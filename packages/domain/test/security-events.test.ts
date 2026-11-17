import { describe, expect, it } from "vitest";
import { assertSafeMetadata, SECURITY_EVENT_TYPES } from "../src/index.js";

describe("security event catalog", () => {
  it("has unique event types", () => {
    expect(new Set(SECURITY_EVENT_TYPES).size).toBe(SECURITY_EVENT_TYPES.length);
  });

  it("rejects metadata keys that look like secrets", () => {
    expect(() => assertSafeMetadata({ otpCode: "123456" })).toThrow("must not contain secrets");
    expect(() => assertSafeMetadata({ sessionToken: "x" })).toThrow();
    expect(() => assertSafeMetadata({ oldRole: "agent", newRole: "admin" })).not.toThrow();
  });

  it("includes the feature 002 events (data model §5)", () => {
    expect(SECURITY_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "integration.connected",
        "integration.disconnected",
        "import.started",
        "import.finished",
        "calendar_feed.added",
        "calendar_feed.changed",
        "calendar_feed.removed",
        "stay.added_manually",
        "stay.changed_manually",
        "stay.cancelled_manually",
        "stay.guest_name_removed",
        "property.removed",
        "property.restored",
        "property.purged",
      ]),
    );
  });
});

describe("feature 002 event metadata (T015)", () => {
  it("lets feed events carry the channel only, never the link", () => {
    expect(() => assertSafeMetadata({ channel: "airbnb" }, "calendar_feed.added")).not.toThrow();
    expect(() =>
      assertSafeMetadata({ url: "https://example.test/x.ics" }, "calendar_feed.added"),
    ).toThrow('must not carry metadata "url"');
    expect(() =>
      assertSafeMetadata({ channel: "https://example.test/x.ics" }, "calendar_feed.changed"),
    ).toThrow("short plain value");
  });

  it("lets stay events carry the stay ID and dates, never the guest name", () => {
    const dates = {
      stayId: "6f1c2a7e-0d4b-4c39-9a51-2b7f1e0c9d11",
      checkInDate: "2027-01-10",
      checkoutDate: "2027-01-12",
    };
    for (const type of [
      "stay.added_manually",
      "stay.changed_manually",
      "stay.cancelled_manually",
      "stay.guest_name_removed",
    ] as const) {
      expect(() => assertSafeMetadata(dates, type)).not.toThrow();
      expect(() => assertSafeMetadata({ ...dates, guestName: "Ana" }, type)).toThrow(
        'must not carry metadata "guestName"',
      );
    }
  });

  it("records whether the provider revoked the credential on disconnect", () => {
    expect(() =>
      assertSafeMetadata(
        { provider: "hostex", providerRevoked: false },
        "integration.disconnected",
      ),
    ).not.toThrow();
  });

  it("lets import events carry counts only", () => {
    expect(() =>
      assertSafeMetadata({ kind: "csv", total: 25, created: 23, failed: 2 }, "import.finished"),
    ).not.toThrow();
    expect(() => assertSafeMetadata({ rows: 25, firstRow: "Casa" }, "import.started")).toThrow();
  });
});
