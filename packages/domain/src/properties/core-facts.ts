/**
 * Core facts and setup status of a property (feature 002 FR-001 to FR-007, data model §1 and §7).
 * Every creation path ends with the same confirmation step over these facts.
 */
export const GUIDE_LANGUAGES = ["es", "en"] as const;
export type GuideLanguage = (typeof GUIDE_LANGUAGES)[number];

export const SETUP_STATUSES = ["needs_details", "to_confirm", "ready"] as const;
export type SetupStatus = (typeof SETUP_STATUSES)[number];

export const PROPERTY_SOURCES = ["manual", "listing_text", "csv", "pms", "duplicate"] as const;
export type PropertySource = (typeof PROPERTY_SOURCES)[number];

/** Facts a property needs before it is set up (FR-001). */
export const REQUIRED_FACTS = [
  "name",
  "addressLine1",
  "city",
  "country",
  "timeZone",
  "checkInTime",
  "checkoutTime",
  "maxGuests",
  "guideLanguages",
] as const;
export type RequiredFact = (typeof REQUIRED_FACTS)[number];

export interface CoreFacts {
  name?: string | null;
  addressLine1?: string | null;
  addressUnit?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  /** ISO 3166-1 alpha-2. */
  country?: string | null;
  /** IANA zone. */
  timeZone?: string | null;
  /** `HH:MM`, read in the property's time zone. */
  checkInTime?: string | null;
  checkoutTime?: string | null;
  maxGuests?: number | null;
  guideLanguages?: readonly GuideLanguage[] | null;
}

function present(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Required facts that are still missing, in the order of REQUIRED_FACTS. */
export function missingFacts(facts: CoreFacts): RequiredFact[] {
  return REQUIRED_FACTS.filter((fact) => !present(facts[fact]));
}

/** Imports keep their facts from the source, so the host still confirms them (FR-004). */
function isImport(source: PropertySource): boolean {
  return source === "csv" || source === "pms";
}

/**
 * The status a new property gets. Manual, listing-text, and duplicate properties come from the
 * confirmation step, so they are `ready` when complete. Imports are `to_confirm` until the host
 * confirms them. Anything incomplete `needs_details`.
 */
export function initialSetupStatus(source: PropertySource, facts: CoreFacts): SetupStatus {
  if (missingFacts(facts).length > 0) return "needs_details";
  return isImport(source) ? "to_confirm" : "ready";
}

/**
 * The status after the host edits facts (data model §7). Clearing a required fact always means
 * `needs_details`. Filling the last one makes a manual, listing-text, or duplicate property
 * `ready`, and a CSV or PMS property `to_confirm`, because its other facts still come from the
 * import.
 */
export function setupStatusAfterEdit(
  current: SetupStatus,
  source: PropertySource,
  facts: CoreFacts,
): SetupStatus {
  if (missingFacts(facts).length > 0) return "needs_details";
  if (current !== "needs_details") return current;
  return isImport(source) ? "to_confirm" : "ready";
}

/** The status after the host confirms an imported property (POST /properties/confirm). */
export function confirmedSetupStatus(facts: CoreFacts): "ready" | "needs_details" {
  return missingFacts(facts).length === 0 ? "ready" : "needs_details";
}

/** Lowercase, without accents, punctuation runs, or extra spaces. */
function fold(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/**
 * Normalized street line, unit, city, and country, for the dismissible duplicate-address warning
 * (FR-007). Null until the street line, city, and country are known.
 */
export function normalizeAddressKey(
  address: Pick<CoreFacts, "addressLine1" | "addressUnit" | "city" | "country">,
): string | null {
  const line1 = fold(address.addressLine1);
  const city = fold(address.city);
  const country = fold(address.country);
  if (!line1 || !city || !country) return null;
  return [line1, fold(address.addressUnit), city, country].join("|");
}

/** Spanish and English, with the workspace's language first (FR-003). */
export function defaultGuideLanguages(first: GuideLanguage): GuideLanguage[] {
  return first === "en" ? ["en", "es"] : ["es", "en"];
}

/** A time of day as `HH:MM` (24-hour). */
export const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
