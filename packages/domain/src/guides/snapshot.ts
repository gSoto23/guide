import type { GuideLanguage } from "../properties/core-facts.js";
import type { SegDocument } from "./segmenter.js";
import type {
  DefaultSectionKind,
  FactKey,
  GuideItemKind,
  GuideItemSource,
  SectionKind,
} from "./template.js";

/**
 * Published snapshots (feature 003 FR-051, FR-052, research R12, R14). A snapshot holds only
 * reviewed items, resolved shared blocks, and references: locked fields appear as IDs inside the
 * documents and facts as keys, so no value is ever frozen in a version.
 */
export const SNAPSHOT_SCHEMA = 1;

export interface DraftText {
  doc: SegDocument | null;
  origin: "source" | "machine" | "reviewed";
  state: "current" | "stale" | "out_of_date" | "pending" | "failed";
}

export interface Recommendation {
  name: string;
  category: string;
  url?: string;
  address?: string;
  benefit?: "none" | "commission" | "discount" | "other";
  benefitNote?: string;
  personalTip: boolean;
}

export interface DraftItem {
  id: string;
  kind: GuideItemKind;
  position: number;
  source: GuideItemSource;
  sourceDetail?: string | null;
  reviewed: boolean;
  sourceLanguage: GuideLanguage;
  topics: readonly string[];
  factKey?: FactKey | null;
  mediaId?: string | null;
  recommendation?: Recommendation | null;
  texts: Partial<Record<GuideLanguage, DraftText>>;
}

export interface DraftSection {
  id: string;
  kind: SectionKind;
  title?: Partial<Record<GuideLanguage, string>> | null;
  position: number;
  hidden: boolean;
  items: readonly DraftItem[];
}

export interface SnapshotItem {
  id: string;
  kind: GuideItemKind;
  sharedBlockId?: string;
  factKey?: FactKey;
  mediaId?: string;
  recommendation?: Recommendation;
  /** Documents by language; a language without a current text falls back to the source (spec 004). */
  texts: Partial<Record<GuideLanguage, SegDocument>>;
  sourceLanguage: GuideLanguage;
}

export interface SnapshotSection {
  id: string;
  kind: SectionKind;
  title?: Partial<Record<GuideLanguage, string>>;
  items: SnapshotItem[];
}

export interface GuideSnapshot {
  schema: typeof SNAPSHOT_SCHEMA;
  languages: GuideLanguage[];
  sections: SnapshotSection[];
}

/** A shared block as published (research R14): its reviewed items in every workspace language. */
export interface SharedBlockSnapshot {
  blockId: string;
  sectionKind: DefaultSectionKind;
  position: number;
  revision: number;
  items: SnapshotItem[];
}

export type SharedLinkMode = "override" | "exclude";

/** Texts that may be published: current ones, and reviewed translations out of date (warned). */
function publishableTexts(
  item: DraftItem,
  languages: readonly GuideLanguage[],
): Partial<Record<GuideLanguage, SegDocument>> {
  const texts: Partial<Record<GuideLanguage, SegDocument>> = {};
  for (const language of languages) {
    const text = item.texts[language];
    if (!text?.doc) continue;
    if (text.state === "current" || text.state === "out_of_date") texts[language] = text.doc;
  }
  return texts;
}

/** A reviewed draft item as it is published. */
export function snapshotItem(item: DraftItem, languages: readonly GuideLanguage[]): SnapshotItem {
  return {
    id: item.id,
    kind: item.kind,
    ...(item.factKey ? { factKey: item.factKey } : {}),
    ...(item.mediaId ? { mediaId: item.mediaId } : {}),
    ...(item.recommendation ? { recommendation: item.recommendation } : {}),
    texts: publishableTexts(item, languages),
    sourceLanguage: item.sourceLanguage,
  };
}

/** The published shared blocks a section inherits, in order (FR-058, FR-059). */
export function inheritedBlocks(
  sectionKind: SectionKind,
  blocks: readonly SharedBlockSnapshot[],
  links: Readonly<Record<string, SharedLinkMode>>,
): SharedBlockSnapshot[] {
  return blocks
    .filter((block) => block.sectionKind === sectionKind && links[block.blockId] === undefined)
    .sort((a, b) => a.position - b.position);
}

/** Tags a block's items with its ID, for later fan-out (research R14). */
function blockItems(block: SharedBlockSnapshot): SnapshotItem[] {
  return block.items.map((item) => ({ ...item, sharedBlockId: block.blockId }));
}

export interface BuildSnapshotInput {
  languages: readonly GuideLanguage[];
  sections: readonly DraftSection[];
  sharedBlocks: readonly SharedBlockSnapshot[];
  links: Readonly<Record<string, SharedLinkMode>>;
}

/** Builds the snapshot a publish stores (FR-051). */
export function buildSnapshot(input: BuildSnapshotInput): GuideSnapshot {
  const sections = [...input.sections]
    .filter((section) => !section.hidden)
    .sort((a, b) => a.position - b.position)
    .map((section): SnapshotSection => {
      const own = [...section.items]
        .filter((item) => item.reviewed)
        .sort((a, b) => a.position - b.position)
        .map((item) => snapshotItem(item, input.languages));
      const inherited = inheritedBlocks(section.kind, input.sharedBlocks, input.links).flatMap(
        blockItems,
      );
      return {
        id: section.id,
        kind: section.kind,
        ...(section.title ? { title: { ...section.title } } : {}),
        items: [...own, ...inherited],
      };
    });
  return { schema: SNAPSHOT_SCHEMA, languages: [...input.languages], sections };
}

/**
 * A shared block published or deleted, applied to an existing snapshot (FR-060, research R14):
 * the block's items are replaced, added after the section's own items, or removed. Nothing else
 * changes, so a guide's unpublished draft edits never go live this way. `block` is null when the
 * block was deleted; `mode` is the guide's link to it, if any.
 */
export function applySharedBlock(
  snapshot: GuideSnapshot,
  blockId: string,
  block: SharedBlockSnapshot | null,
  mode: SharedLinkMode | undefined,
): GuideSnapshot {
  const sections = snapshot.sections.map((section) => {
    const firstOld = section.items.findIndex((item) => item.sharedBlockId === blockId);
    const kept = section.items.filter((item) => item.sharedBlockId !== blockId);
    const inherits = block !== null && mode === undefined && block.sectionKind === section.kind;
    if (!inherits) return firstOld === -1 ? section : { ...section, items: kept };
    const fresh = blockItems(block);
    const at = firstOld === -1 ? kept.length : firstOld;
    return { ...section, items: [...kept.slice(0, at), ...fresh, ...kept.slice(at)] };
  });
  return { ...snapshot, sections };
}

/**
 * JSON with object keys sorted at every level, so a snapshot read back from `jsonb` (which
 * reorders keys) compares and hashes like the one that was stored.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether applying a block changed the snapshot, so a new version is needed. */
export function snapshotsDiffer(a: GuideSnapshot, b: GuideSnapshot): boolean {
  return canonicalJson(a) !== canonicalJson(b);
}

/** Every locked-field ID a snapshot references. */
export function snapshotLockedFieldIds(snapshot: GuideSnapshot): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (record.type === "lockedField") {
      const attrs = record.attrs as { fieldId?: unknown } | undefined;
      if (typeof attrs?.fieldId === "string") ids.add(attrs.fieldId);
    }
    for (const value of Object.values(record)) visit(value);
  };
  visit(snapshot.sections);
  return [...ids];
}
