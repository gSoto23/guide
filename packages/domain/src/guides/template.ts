/**
 * The default guide template (feature 003 FR-001, FR-002, research R16): the nine default
 * sections in their order, custom sections, and the fact items every guide starts with.
 */
export const DEFAULT_SECTION_KINDS = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
] as const;
export type DefaultSectionKind = (typeof DEFAULT_SECTION_KINDS)[number];
export type SectionKind = DefaultSectionKind | "custom";

/** At most 10 custom sections per guide (FR-002). */
export const MAX_CUSTOM_SECTIONS = 10;
/** Images and videos per section (FR-009). */
export const MAX_IMAGES_PER_SECTION = 20;
export const MAX_VIDEOS_PER_SECTION = 3;
/** Characters of text per section and language (FR-010). */
export const MAX_SECTION_TEXT_LENGTH = 20_000;

export const GUIDE_ITEM_KINDS = ["text", "image", "video", "recommendation", "fact"] as const;
export type GuideItemKind = (typeof GUIDE_ITEM_KINDS)[number];

export const GUIDE_ITEM_SOURCES = [
  "host",
  "listing",
  "pms",
  "document",
  "interview",
  "copy",
] as const;
export type GuideItemSource = (typeof GUIDE_ITEM_SOURCES)[number];

/** Core facts shown as live values (FR-006). */
export const FACT_KEYS = ["check_in_time", "checkout_time", "max_guests", "address"] as const;
export type FactKey = (typeof FACT_KEYS)[number];

/** The fact items every guide starts with, by section and position (research R16). */
export const DEFAULT_FACT_ITEMS: readonly {
  sectionKind: DefaultSectionKind;
  factKey: FactKey;
  position: number;
}[] = [
  { sectionKind: "arrival", factKey: "check_in_time", position: 0 },
  { sectionKind: "arrival", factKey: "address", position: 1 },
  { sectionKind: "house_rules", factKey: "max_guests", position: 0 },
  { sectionKind: "checkout", factKey: "checkout_time", position: 0 },
];

/** Where a locked field of each kind is listed by default (data model §2). */
export function defaultLockedFieldSection(kind: string): DefaultSectionKind {
  return kind === "wifi_password" ? "wifi" : "arrival";
}

export type SectionStatus = "missing" | "needs_review" | "ready";

/**
 * A section's status (FR-013): Missing when it holds nothing but facts, Needs review when any item
 * is unreviewed or a reviewed translation is out of date, Ready otherwise.
 */
export function sectionStatus(
  items: readonly { kind: GuideItemKind; reviewed: boolean; hasOutOfDateTranslation?: boolean }[],
): SectionStatus {
  const content = items.filter((item) => item.kind !== "fact");
  if (content.length === 0) return "missing";
  return content.some((item) => !item.reviewed || item.hasOutOfDateTranslation)
    ? "needs_review"
    : "ready";
}

/** The main language of a guide: the first of the property's guide languages (FR-003). */
export function mainLanguage<L extends string>(guideLanguages: readonly L[]): L {
  const first = guideLanguages[0];
  if (!first) throw new Error("A property has at least one guide language");
  return first;
}
