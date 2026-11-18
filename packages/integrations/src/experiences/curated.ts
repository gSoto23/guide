import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The curated Explore list (feature 009 research R3): a reviewed file of Civitatis entries per
 * destination key, with Guidesk-written text, and optional Viator destination pins. Parsed strictly:
 * an invalid file fails at start-up instead of showing a bad link to guests.
 */
export const CURATED_CATEGORIES = [
  "tours",
  "food_drink",
  "outdoor",
  "water",
  "culture",
  "day_trips",
  "other",
] as const;

export interface CuratedEntry {
  id: string;
  url: string;
  category: (typeof CURATED_CATEGORIES)[number];
  title: { es: string; en: string };
  description: { es: string; en: string };
  durationMinutes: number | null;
  priceFrom: number | null;
  currency: string | null;
}

export interface CuratedDestination {
  viatorDestinationId: string | null;
  civitatis: CuratedEntry[];
}

export type CuratedCatalog = ReadonlyMap<string, CuratedDestination>;

export class CuratedCatalogError extends Error {}

const KEY = /^[a-z]{2}:[a-z0-9-]{1,116}$/;
const ENTRY_ID = /^[a-z0-9-]{1,64}$/;
const CIVITATIS_HOSTS = new Set(["civitatis.com", "www.civitatis.com"]);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function localized(value: unknown, max: number, where: string): { es: string; en: string } {
  if (!isObject(value)) throw new CuratedCatalogError(`${where}: expected { es, en }`);
  const out = { es: value.es, en: value.en };
  for (const [language, entry] of Object.entries(out)) {
    if (typeof entry !== "string" || !entry.trim() || entry.length > max) {
      throw new CuratedCatalogError(`${where}.${language}: 1 to ${max} characters`);
    }
  }
  return out as { es: string; en: string };
}

function entry(value: unknown, where: string): CuratedEntry {
  if (!isObject(value)) throw new CuratedCatalogError(`${where}: expected an object`);
  const id = value.id;
  if (typeof id !== "string" || !ENTRY_ID.test(id)) {
    throw new CuratedCatalogError(`${where}.id: lowercase letters, digits, hyphens`);
  }
  let url: URL;
  try {
    url = new URL(String(value.url));
  } catch {
    throw new CuratedCatalogError(`${where}.url: not a URL`);
  }
  if (
    url.protocol !== "https:" ||
    !CIVITATIS_HOSTS.has(url.hostname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.port
  ) {
    throw new CuratedCatalogError(`${where}.url: an HTTPS Civitatis page without a query string`);
  }
  const category = value.category;
  if (!(CURATED_CATEGORIES as readonly unknown[]).includes(category)) {
    throw new CuratedCatalogError(`${where}.category: unknown`);
  }
  const duration = value.durationMinutes ?? null;
  if (
    duration !== null &&
    (!Number.isInteger(duration) || (duration as number) < 1 || (duration as number) > 20160)
  ) {
    throw new CuratedCatalogError(`${where}.durationMinutes: 1 to 20160`);
  }
  const price = value.priceFrom ?? null;
  const currency = value.currency ?? null;
  if ((price === null) !== (currency === null)) {
    throw new CuratedCatalogError(`${where}: priceFrom and currency go together`);
  }
  if (price !== null && (typeof price !== "number" || price < 0)) {
    throw new CuratedCatalogError(`${where}.priceFrom: a number ≥ 0`);
  }
  if (currency !== null && (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) {
    throw new CuratedCatalogError(`${where}.currency: ISO 4217`);
  }
  return {
    id,
    url: url.toString(),
    category: category as CuratedEntry["category"],
    title: localized(value.title, 200, `${where}.title`),
    description: localized(value.description, 600, `${where}.description`),
    durationMinutes: duration as number | null,
    priceFrom: price as number | null,
    currency: currency as string | null,
  };
}

export function parseCuratedCatalog(value: unknown): CuratedCatalog {
  if (!isObject(value) || !isObject(value.destinations)) {
    throw new CuratedCatalogError("expected { destinations: { key: … } }");
  }
  const out = new Map<string, CuratedDestination>();
  const ids = new Set<string>();
  for (const [key, raw] of Object.entries(value.destinations)) {
    if (!KEY.test(key)) throw new CuratedCatalogError(`${key}: not a destination key`);
    if (!isObject(raw)) throw new CuratedCatalogError(`${key}: expected an object`);
    const pin = raw.viatorDestinationId ?? null;
    if (pin !== null && (typeof pin !== "string" || !/^[0-9]{1,12}$/.test(pin))) {
      throw new CuratedCatalogError(`${key}.viatorDestinationId: digits`);
    }
    const list = raw.civitatis ?? [];
    if (!Array.isArray(list) || list.length > 20) {
      throw new CuratedCatalogError(`${key}.civitatis: at most 20 entries`);
    }
    const entries = list.map((item, index) => entry(item, `${key}.civitatis[${index}]`));
    for (const item of entries) {
      if (ids.has(item.id)) throw new CuratedCatalogError(`${item.id}: duplicate id`);
      ids.add(item.id);
    }
    out.set(key, { viatorDestinationId: pin as string | null, civitatis: entries });
  }
  return out;
}

/** The repository's curated file (`packages/integrations/catalog/experiences.json`). */
export function loadCuratedCatalog(
  path: string = fileURLToPath(new URL("../../catalog/experiences.json", import.meta.url)),
): CuratedCatalog {
  return parseCuratedCatalog(JSON.parse(readFileSync(path, "utf8")));
}
