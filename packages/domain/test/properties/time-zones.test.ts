import { describe, expect, it } from "vitest";
import { CITY_ZONES, COUNTRY_ZONES } from "../../src/properties/time-zone-data.js";
import {
  isKnownTimeZone,
  suggestTimeZone,
  timeZoneMatchesCountry,
  zonesForCountry,
} from "../../src/properties/time-zones.js";

describe("time zone suggestion without an outside service (FR-002, R11)", () => {
  it("suggests the only zone of a single-zone country", () => {
    expect(suggestTimeZone("CR", "Sámara")).toEqual({
      suggested: "America/Costa_Rica",
      choices: ["America/Costa_Rica"],
    });
    expect(suggestTimeZone("cr", null).suggested).toBe("America/Costa_Rica");
  });

  it("suggests a city's zone in a country with several zones, ignoring case and accents", () => {
    expect(suggestTimeZone("MX", "Cancún").suggested).toBe("America/Cancun");
    expect(suggestTimeZone("MX", "cancun").suggested).toBe("America/Cancun");
    expect(suggestTimeZone("MX", "  CANCÚN ").suggested).toBe("America/Cancun");
  });

  it("offers the country's zones when the city is not recognized", () => {
    const result = suggestTimeZone("MX", "Ciudad Inventada");
    expect(result.suggested).toBeNull();
    expect(result.choices).toEqual(zonesForCountry("MX"));
    expect(result.choices).toContain("America/Mexico_City");
    expect(result.choices.length).toBeGreaterThan(1);
  });

  it("returns no zones for an unknown country", () => {
    expect(suggestTimeZone("ZZ", "Somewhere")).toEqual({ suggested: null, choices: [] });
  });

  it("warns when a zone does not belong to the country", () => {
    expect(timeZoneMatchesCountry("America/Cancun", "MX")).toBe(true);
    expect(timeZoneMatchesCountry("Europe/Madrid", "MX")).toBe(false);
  });

  it("only uses zones this runtime knows (the data check in CI, T038)", () => {
    const supported = new Set(Intl.supportedValuesOf("timeZone"));
    const zones = new Set([
      ...Object.values(COUNTRY_ZONES).flat(),
      ...Object.values(CITY_ZONES).flatMap((table) => Object.keys(table)),
    ]);
    // ICU lists some canonical zones under older names (Asia/Calcutta), so formatting counts too.
    for (const zone of zones) expect(supported.has(zone) || isKnownTimeZone(zone), zone).toBe(true);
    expect(isKnownTimeZone("Mars/Olympus_Mons")).toBe(false);
  });
});
