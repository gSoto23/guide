/**
 * Explore: partner experiences near a property (feature 009). Pure rules shared by the API, the
 * worker, and the guest app: categories, destination keys, the partner tag mapping, selection, host
 * settings, refs, and safe redirect targets (research R5 to R8, R10).
 */

export const EXPERIENCE_CATEGORIES = [
  "tours",
  "food_drink",
  "outdoor",
  "water",
  "culture",
  "day_trips",
  "other",
] as const;
export type ExperienceCategory = (typeof EXPERIENCE_CATEGORIES)[number];

export const EXPERIENCE_PARTNERS = ["viator", "civitatis"] as const;
export type ExperiencePartner = (typeof EXPERIENCE_PARTNERS)[number];

export const PARTNER_NAMES: Record<ExperiencePartner, string> = {
  viator: "Viator",
  civitatis: "Civitatis",
};

/** Hosts a redirect may lead to (research R8). Exact host names: no subdomain wildcards. */
export const PARTNER_HOSTS: Record<ExperiencePartner, readonly string[]> = {
  viator: ["viator.com", "www.viator.com"],
  civitatis: ["civitatis.com", "www.civitatis.com"],
};

/** Viator lets search results be kept at most 1 hour (research R2). */
export const VIATOR_KEEP_MINUTES = 60;
/** At most this many experiences per property, and per category (FR-002, FR-018, research R7). */
export const EXPLORE_LIMIT = 12;
export const EXPLORE_PER_CATEGORY = 4;
/** Hidden experience refs kept per property (data model). */
export const MAX_HIDDEN_EXPERIENCES = 200;

export const EXPERIENCE_REF = /^(viator|civitatis)-[A-Za-z0-9_-]{1,64}$/;
export const PARTNER_PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isExperienceCategory(value: unknown): value is ExperienceCategory {
  return typeof value === "string" && (EXPERIENCE_CATEGORIES as readonly string[]).includes(value);
}

export function experienceRef(partner: ExperiencePartner, productId: string): string {
  return `${partner}-${productId}`;
}

export function parseExperienceRef(
  ref: string,
): { partner: ExperiencePartner; productId: string } | null {
  if (!EXPERIENCE_REF.test(ref)) return null;
  const dash = ref.indexOf("-");
  return { partner: ref.slice(0, dash) as ExperiencePartner, productId: ref.slice(dash + 1) };
}

/** Lowercase, accents removed, anything else than letters and digits collapsed to one hyphen. */
export function normalizePlaceName(value: string): string {
  const plain = value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  let out = "";
  let pendingHyphen = false;
  for (const char of plain) {
    if (/[a-z0-9]/.test(char)) {
      if (pendingHyphen && out.length > 0) out += "-";
      out += char;
      pendingHyphen = false;
    } else {
      pendingHyphen = true;
    }
  }
  return out;
}

/** `{country}:{city}`, for example `cr:samara`; null without a country or city (research R5). */
export function destinationKey(
  country: string | null | undefined,
  city: string | null | undefined,
): string | null {
  if (!country || !/^[A-Za-z]{2}$/.test(country) || !city) return null;
  const name = normalizePlaceName(city);
  if (!name) return null;
  return `${country.toLowerCase()}:${name}`.slice(0, 120);
}

/**
 * Viator tag names (the tag and its ancestors, English) to a category, first rule wins (research R6).
 * Rules are checked in this order, so "Food Tours" is food and drink, not tours.
 */
const TAG_RULES: readonly [ExperienceCategory, RegExp][] = [
  ["food_drink", /\b(food|drink|wine|beer|coffee|culinary|cooking|tasting|chocolate|dining)\b/i],
  [
    "water",
    /\b(water|snorkel\w*|scuba|diving|surf\w*|boat\w*|cruise\w*|kayak\w*|paddle\w*|sailing|catamaran|fishing|rafting)\b/i,
  ],
  ["day_trips", /\b(day trips?|excursions?|multi-day)\b/i],
  ["culture", /\b(museums?|cultur\w*|history|historical|art|heritage|walking tours?|shows?)\b/i],
  [
    "outdoor",
    /\b(nature|adventure|hiking|zip\s?lin\w*|canopy|wildlife|national parks?|volcano\w*|horseback|atv|outdoor)\b/i,
  ],
  ["tours", /\b(tours?|sightseeing)\b/i],
];

export function categoryForTags(tagNames: readonly string[]): ExperienceCategory {
  for (const [category, rule] of TAG_RULES) {
    if (tagNames.some((name) => rule.test(name))) return category;
  }
  return "other";
}

export interface ExploreSettingsValues {
  experiencesEnabled: boolean;
  hiddenCategories: ExperienceCategory[];
}

export const DEFAULT_EXPLORE_SETTINGS: ExploreSettingsValues = {
  experiencesEnabled: true,
  hiddenCategories: [],
};

export interface ExploreSettingsRow extends ExploreSettingsValues {
  followsDefault: boolean;
  hiddenExperiences: string[];
}

/**
 * The settings a property uses: its own when it doesn't follow the workspace default, else the
 * workspace default, else the defaults. Hidden experiences are always the property's (research R10).
 */
export function effectiveExploreSettings(
  workspace: ExploreSettingsValues | null,
  property: ExploreSettingsRow | null,
): ExploreSettingsValues & { hiddenExperiences: string[] } {
  const base =
    property && !property.followsDefault ? property : (workspace ?? DEFAULT_EXPLORE_SETTINGS);
  return {
    experiencesEnabled: base.experiencesEnabled,
    hiddenCategories: [...base.hiddenCategories],
    hiddenExperiences: property ? [...property.hiddenExperiences] : [],
  };
}

export interface ExperienceCandidate {
  ref: string;
  partner: ExperiencePartner;
  /** True for entries from Guidesk's curated list (research R3). */
  curated?: boolean;
  category: ExperienceCategory;
  rating: number | null;
  reviewCount: number | null;
}

function score(candidate: ExperienceCandidate): number {
  if (candidate.rating === null) return -1;
  return candidate.rating * Math.log10((candidate.reviewCount ?? 0) + 10);
}

/**
 * Guidesk's curated entries are hand-picked for the destination, so they come first; partner
 * products follow by rating and reviews, with barely reviewed ones (under 10) last (research R7).
 */
function rank(candidate: ExperienceCandidate): number {
  if (candidate.curated) return 1000;
  if (candidate.rating === null) return -1;
  if ((candidate.reviewCount ?? 0) < 10) return Math.min(score(candidate), 0.4);
  return score(candidate);
}

/**
 * The experiences guests see (FR-018, research R7): hidden categories and refs removed, ranked, at
 * most 4 per category and 12 in total, in the fixed category order. Deterministic for equal input.
 */
export function selectExperiences<T extends ExperienceCandidate>(
  candidates: readonly T[],
  settings: {
    experiencesEnabled: boolean;
    hiddenCategories: readonly string[];
    hiddenExperiences: readonly string[];
  },
): T[] {
  if (!settings.experiencesEnabled) return [];
  const hiddenCategories = new Set(settings.hiddenCategories);
  const hiddenRefs = new Set(settings.hiddenExperiences);
  const seen = new Set<string>();
  const ranked = candidates
    .filter((candidate) => {
      if (hiddenCategories.has(candidate.category) || hiddenRefs.has(candidate.ref)) return false;
      if (seen.has(candidate.ref)) return false;
      seen.add(candidate.ref);
      return true;
    })
    .sort(
      (a, b) =>
        rank(b) - rank(a) ||
        EXPERIENCE_PARTNERS.indexOf(a.partner) - EXPERIENCE_PARTNERS.indexOf(b.partner) ||
        (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
    );
  const perCategory = new Map<string, number>();
  const picked: T[] = [];
  for (const candidate of ranked) {
    if (picked.length >= EXPLORE_LIMIT) break;
    const count = perCategory.get(candidate.category) ?? 0;
    if (count >= EXPLORE_PER_CATEGORY) continue;
    perCategory.set(candidate.category, count + 1);
    picked.push(candidate);
  }
  const order = (category: string) => EXPERIENCE_CATEGORIES.indexOf(category as ExperienceCategory);
  return picked
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => order(a.candidate.category) - order(b.candidate.category) || a.index - b.index)
    .map(({ candidate }) => candidate);
}

/** Groups selected experiences by category, keeping their order. */
export function groupByCategory<T extends { category: ExperienceCategory }>(
  experiences: readonly T[],
): { category: ExperienceCategory; experiences: T[] }[] {
  const groups: { category: ExperienceCategory; experiences: T[] }[] = [];
  for (const experience of experiences) {
    const last = groups[groups.length - 1];
    if (last && last.category === experience.category) last.experiences.push(experience);
    else groups.push({ category: experience.category, experiences: [experience] });
  }
  return groups;
}

/** Explore is visible when the guide has host tips or the property has a selected experience. */
export function exploreVisible(tips: number, selected: number): boolean {
  return tips > 0 || selected > 0;
}

/** True for an HTTPS URL on one of the partner's hosts, without credentials or an unusual port. */
export function isPartnerUrl(partner: ExperiencePartner, value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    PARTNER_HOSTS[partner].includes(url.hostname.toLowerCase())
  );
}

/**
 * The address a click may redirect to (research R8): the stored partner page, only on the partner's
 * hosts; Civitatis gets the affiliate number. Null when the URL is not safe or no account is set.
 */
export function partnerRedirectTarget(
  partner: ExperiencePartner,
  storedUrl: string,
  civitatisAffiliateId: string | null,
): string | null {
  if (!isPartnerUrl(partner, storedUrl)) return null;
  if (partner === "civitatis") {
    if (!civitatisAffiliateId || !/^[0-9]{1,12}$/.test(civitatisAffiliateId)) return null;
    const url = new URL(storedUrl);
    url.searchParams.set("aid", civitatisAffiliateId);
    return url.toString();
  }
  return storedUrl;
}

export interface PartnerDestinationRef {
  id: string;
  name: string;
  type: string;
  lookupId: string;
}

const COUNTRY_NAMES = new Intl.DisplayNames(["en"], { type: "region" });

/**
 * The partner destination for a property (research R5): within the country (matched by its English
 * name), a city-like destination with the same normalized name, else one matching the region; null
 * when nothing matches. Ties go to the deepest destination, then the lowest ID, so the result is
 * stable.
 */
export function matchPartnerDestination(
  destinations: readonly PartnerDestinationRef[],
  place: { country: string; city: string | null; region: string | null },
): string | null {
  let countryName: string | undefined;
  try {
    countryName = COUNTRY_NAMES.of(place.country.toUpperCase());
  } catch {
    return null;
  }
  if (!countryName) return null;
  const countryKey = normalizePlaceName(countryName);
  const country = destinations.find(
    (item) => item.type === "COUNTRY" && normalizePlaceName(item.name) === countryKey,
  );
  if (!country) return null;
  const inside = destinations.filter((item) => item.lookupId.startsWith(`${country.lookupId}.`));
  const best = (name: string | null) => {
    if (!name) return null;
    const key = normalizePlaceName(name);
    if (!key) return null;
    const matches = inside
      .filter((item) => normalizePlaceName(item.name) === key)
      .sort(
        (a, b) =>
          b.lookupId.split(".").length - a.lookupId.split(".").length ||
          Number(a.id) - Number(b.id),
      );
    return matches[0]?.id ?? null;
  };
  return best(place.city) ?? best(place.region);
}
