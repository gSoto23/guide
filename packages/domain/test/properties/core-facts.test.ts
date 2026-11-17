import { describe, expect, it } from "vitest";
import {
  confirmedSetupStatus,
  defaultGuideLanguages,
  initialSetupStatus,
  missingFacts,
  normalizeAddressKey,
  REQUIRED_FACTS,
  setupStatusAfterEdit,
  type CoreFacts,
} from "../../src/properties/core-facts.js";

const complete: CoreFacts = {
  name: "Casa Colibrí",
  addressLine1: "Calle Ficticia 123",
  city: "Sámara",
  country: "CR",
  timeZone: "America/Costa_Rica",
  checkInTime: "15:00",
  checkoutTime: "11:00",
  maxGuests: 4,
  guideLanguages: ["es", "en"],
};

describe("required core facts (FR-001)", () => {
  it("lists name, street line, city, country, time zone, times, maximum guests, and a language", () => {
    expect(REQUIRED_FACTS).toEqual([
      "name",
      "addressLine1",
      "city",
      "country",
      "timeZone",
      "checkInTime",
      "checkoutTime",
      "maxGuests",
      "guideLanguages",
    ]);
  });

  it("reports the missing facts, treating blanks and empty language lists as missing", () => {
    expect(missingFacts(complete)).toEqual([]);
    expect(missingFacts({ ...complete, timeZone: null, city: "  ", guideLanguages: [] })).toEqual([
      "city",
      "timeZone",
      "guideLanguages",
    ]);
    expect(missingFacts({ name: "Solo nombre" })).toEqual(REQUIRED_FACTS.slice(1));
  });

  it("does not require the unit, region, or postal code", () => {
    expect(
      missingFacts({ ...complete, addressUnit: null, region: null, postalCode: null }),
    ).toEqual([]);
  });
});

describe("setup status (FR-004, data model §7)", () => {
  it("is ready for a confirmed creation with every fact, and needs_details when one is missing", () => {
    for (const source of ["manual", "listing_text", "duplicate"] as const) {
      expect(initialSetupStatus(source, complete)).toBe("ready");
      expect(initialSetupStatus(source, { ...complete, maxGuests: null })).toBe("needs_details");
    }
  });

  it("is to_confirm for complete imports, and needs_details for incomplete ones", () => {
    for (const source of ["csv", "pms"] as const) {
      expect(initialSetupStatus(source, complete)).toBe("to_confirm");
      expect(initialSetupStatus(source, { ...complete, timeZone: null })).toBe("needs_details");
    }
  });

  it("goes from ready to needs_details when a required fact is cleared", () => {
    expect(setupStatusAfterEdit("ready", "manual", { ...complete, checkInTime: null })).toBe(
      "needs_details",
    );
    expect(setupStatusAfterEdit("ready", "manual", complete)).toBe("ready");
  });

  it("makes a manual, listing-text, or duplicate property ready when the last fact is filled", () => {
    for (const source of ["manual", "listing_text", "duplicate"] as const) {
      expect(setupStatusAfterEdit("needs_details", source, complete)).toBe("ready");
    }
  });

  it("makes a CSV or PMS property to_confirm when the last fact is filled", () => {
    for (const source of ["csv", "pms"] as const) {
      expect(setupStatusAfterEdit("needs_details", source, complete)).toBe("to_confirm");
      expect(setupStatusAfterEdit("to_confirm", source, complete)).toBe("to_confirm");
    }
  });

  it("confirms only properties with every fact", () => {
    expect(confirmedSetupStatus(complete)).toBe("ready");
    expect(confirmedSetupStatus({ ...complete, country: null })).toBe("needs_details");
  });
});

describe("address key for the duplicate warning (FR-007)", () => {
  it("ignores case, accents, and spacing", () => {
    const a = normalizeAddressKey({
      addressLine1: "Calle  Ficticia 123",
      addressUnit: null,
      city: "Sámara",
      country: "CR",
    });
    const b = normalizeAddressKey({
      addressLine1: " calle ficticia 123 ",
      addressUnit: "",
      city: "SAMARA",
      country: "cr",
    });
    expect(a).toBe(b);
    expect(a).toBe("calle ficticia 123||samara|cr");
  });

  it("keeps the unit, so two apartments in one building differ", () => {
    const base = { addressLine1: "Calle 1", city: "Lima", country: "PE" };
    expect(normalizeAddressKey({ ...base, addressUnit: "Apto 2" })).not.toBe(
      normalizeAddressKey({ ...base, addressUnit: "Apto 3" }),
    );
  });

  it("is null without a street line, city, and country", () => {
    expect(normalizeAddressKey({ addressLine1: "Calle 1", city: null, country: "CR" })).toBeNull();
  });
});

describe("guide languages (FR-003)", () => {
  it("default to Spanish and English, with the workspace language first", () => {
    expect(defaultGuideLanguages("es")).toEqual(["es", "en"]);
    expect(defaultGuideLanguages("en")).toEqual(["en", "es"]);
  });
});
