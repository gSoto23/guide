/**
 * Generates src/properties/time-zone-data.ts (research R11, T038): country → IANA zones from the
 * IANA time zone database's zone1970.tab, and, for countries with several zones, city names →
 * zone from the GeoNames cities15000 dataset (CC BY 4.0, see NOTICE.md). Sources are downloaded
 * into the ignored folder .tz-sources/. Run with `pnpm --filter @guidesk/domain tz:generate`.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sources = `${root}.tz-sources`;
const output = `${root}src/properties/time-zone-data.ts`;

async function download(url: string, file: string): Promise<void> {
  if (existsSync(file)) return;
  const response = await fetch(url, { headers: { "user-agent": "guidesk-tz-generator" } });
  if (!response.ok) throw new Error(`Download failed: ${url} (${response.status})`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}

/** Lowercase, without accents or punctuation; how hosts' city input is matched. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

const LATIN = /^[\p{Script=Latin}\s'’.()-]+$/u;

/** Alternate names (for example "Mexico City") are kept only for large cities, to keep the file small. */
const ALTERNATES_MIN_POPULATION = 200_000;

/**
 * Zones this Node.js runtime can format; newer zones wait for a runtime that knows them.
 * (`Intl.supportedValuesOf` lists ICU's older aliases, such as Asia/Calcutta for Asia/Kolkata,
 * so formatting is the reliable check.)
 */
function runtimeKnows(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
const skippedZones = new Set<string>();

mkdirSync(sources, { recursive: true });
await download("https://data.iana.org/time-zones/data/zone1970.tab", `${sources}/zone1970.tab`);
await download(
  "https://download.geonames.org/export/dump/cities15000.zip",
  `${sources}/cities15000.zip`,
);
if (!existsSync(`${sources}/cities15000.txt`)) {
  execFileSync("unzip", ["-o", "-q", `${sources}/cities15000.zip`, "-d", sources]);
}

// zone1970.tab: country codes (comma-separated), coordinates, zone, comment.
const countryZones = new Map<string, Set<string>>();
for (const line of readFileSync(`${sources}/zone1970.tab`, "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const [codes, , zone] = line.split("\t");
  if (!codes || !zone) continue;
  if (!runtimeKnows(zone)) {
    skippedZones.add(zone);
    continue;
  }
  for (const code of codes.split(",")) {
    if (!countryZones.has(code)) countryZones.set(code, new Set());
    countryZones.get(code)!.add(zone);
  }
}

// cities15000.txt: geonameid, name, asciiname, alternatenames, ..., country code (8), ..., timezone (17).
const cityZones = new Map<string, Map<string, string>>();
const ambiguous = new Map<string, Set<string>>();
for (const line of readFileSync(`${sources}/cities15000.txt`, "utf8").split("\n")) {
  const fields = line.split("\t");
  const [name, asciiName, alternates] = [fields[1], fields[2], fields[3]];
  const country = fields[8];
  const population = Number(fields[14] ?? 0);
  const zone = fields[17];
  if (!name || !country || !zone) continue;
  const zones = countryZones.get(country);
  // Single-zone countries need no city table; zones outside the country's list are links.
  if (!zones || zones.size < 2 || !zones.has(zone)) continue;
  const names = new Set<string>([fold(name), fold(asciiName ?? "")]);
  if (population >= ALTERNATES_MIN_POPULATION) {
    for (const alternate of (alternates ?? "").split(",")) {
      if (alternate.length <= 40 && LATIN.test(alternate)) names.add(fold(alternate));
    }
  }
  if (!cityZones.has(country)) cityZones.set(country, new Map());
  if (!ambiguous.has(country)) ambiguous.set(country, new Set());
  const table = cityZones.get(country)!;
  const blocked = ambiguous.get(country)!;
  for (const key of names) {
    if (key.length < 2 || blocked.has(key)) continue;
    const existing = table.get(key);
    if (existing && existing !== zone) {
      // The same name in two zones of one country: let the host choose (FR-002).
      table.delete(key);
      blocked.add(key);
    } else {
      table.set(key, zone);
    }
  }
}

const sortedCountries = [...countryZones.keys()].sort();
const countryLines = sortedCountries.map(
  (code) => `  ${code}: ${JSON.stringify([...countryZones.get(code)!].sort())},`,
);
// Grouped by zone, which keeps the file about half the size of a flat name → zone table.
const cityLines = [...cityZones.keys()].sort().map((code) => {
  const byZone = new Map<string, string[]>();
  for (const [key, zone] of cityZones.get(code)!) {
    if (!byZone.has(zone)) byZone.set(zone, []);
    byZone.get(zone)!.push(key);
  }
  const zones = [...byZone.keys()].sort();
  return `  ${code}: {\n${zones.map((zone) => `    ${JSON.stringify(zone)}: ${JSON.stringify(byZone.get(zone)!.sort())},`).join("\n")}\n  },`;
});

writeFileSync(
  output,
  `/**
 * Generated by scripts/generate-time-zones.ts (research R11). Do not edit by hand.
 *
 * Sources: the IANA time zone database (zone1970.tab, public domain) and GeoNames cities15000
 * (https://www.geonames.org/, CC BY 4.0; attribution in NOTICE.md). Zones the generating
 * Node.js runtime cannot format are left out until the runtime knows them.
 */

/** Country (ISO 3166-1 alpha-2) → IANA zones used there since 1970. */
export const COUNTRY_ZONES: Readonly<Record<string, readonly string[]>> = {
${countryLines.join("\n")}
};

/**
 * For countries with several zones: zone → accent-folded city names, including alternate names
 * of large cities. Names that appear in two zones of the same country are left out, so the host
 * chooses.
 */
export const CITY_ZONES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
${cityLines.join("\n")}
};
`,
);
if (skippedZones.size > 0) {
  console.warn(`Skipped zones this runtime does not know: ${[...skippedZones].sort().join(", ")}`);
}
console.warn(
  `Wrote ${output}: ${sortedCountries.length} countries, ${[...cityZones.values()].reduce((n, t) => n + t.size, 0)} city names.`,
);
