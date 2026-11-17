import { CITY_ZONES, COUNTRY_ZONES } from "./time-zone-data.js";

/**
 * Time zone suggestion from country and city with Guidesk's own reference data (FR-002,
 * research R11). No address is sent anywhere. When a country has several zones and the city is
 * not recognized, the host chooses among the country's zones.
 */
export interface TimeZoneSuggestion {
  suggested: string | null;
  choices: readonly string[];
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/** City name → zone per country, built on first use from the zone-grouped data. */
const cityIndex = new Map<string, Map<string, string>>();

function citiesOf(country: string): Map<string, string> | undefined {
  const cached = cityIndex.get(country);
  if (cached) return cached;
  const table = CITY_ZONES[country];
  if (!table) return undefined;
  const index = new Map<string, string>();
  for (const [zone, names] of Object.entries(table)) {
    for (const name of names) index.set(name, zone);
  }
  cityIndex.set(country, index);
  return index;
}

/** IANA zones of a country (ISO 3166-1 alpha-2), or none for an unknown code. */
export function zonesForCountry(country: string): readonly string[] {
  return COUNTRY_ZONES[country.trim().toUpperCase()] ?? [];
}

export function suggestTimeZone(country: string, city?: string | null): TimeZoneSuggestion {
  const code = country.trim().toUpperCase();
  const choices = zonesForCountry(code);
  if (choices.length === 1) return { suggested: choices[0] ?? null, choices };
  if (choices.length === 0 || !city) return { suggested: null, choices };
  return { suggested: citiesOf(code)?.get(fold(city)) ?? null, choices };
}

/** False shows the mismatch warning: the zone is not one of the country's zones (FR-002). */
export function timeZoneMatchesCountry(zone: string, country: string): boolean {
  return zonesForCountry(country).includes(zone);
}

/** True for a zone this runtime can format, the only zones a property may use. */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone.includes("/") || zone === "UTC";
  } catch {
    return false;
  }
}
