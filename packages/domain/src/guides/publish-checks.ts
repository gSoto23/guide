import { containsRestrictedValue } from "../properties/restricted-values.js";
import type { CompletenessResult } from "./completeness.js";
import { foldForMatch } from "./completeness.js";
import { docPlainText, docReferences } from "./segmenter.js";
import type { GuideLanguage } from "../properties/core-facts.js";
import type { DraftSection } from "./snapshot.js";
import { ESSENTIAL_TOPICS, guideTopic } from "./topics.js";

/**
 * The publish check (feature 003 FR-049, FR-050, research R13): what blocks publishing, which
 * items are left out because they need review, and warnings that never block.
 */
export type PublishBlocker = "not_ready" | "pending_deletion";

export type PublishWarning =
  | { kind: "missing_essential"; topicId: string; sectionKind: string }
  | { kind: "unset_locked_field"; fieldId: string }
  | { kind: "code_like_text"; sectionId: string; itemId: string }
  | { kind: "off_platform"; sectionId: string; itemId: string }
  | { kind: "unreviewed_translations"; count: number }
  | { kind: "out_of_date_translations"; count: number };

export interface PublishCheckInput {
  /** The property's setup status is `ready` (spec 002 FR-004). */
  setupReady: boolean;
  workspaceActive: boolean;
  languages: readonly GuideLanguage[];
  sections: readonly DraftSection[];
  completeness: CompletenessResult;
  /** Locked fields of the property and whether each holds a value. */
  lockedFields: readonly { id: string; isSet: boolean }[];
  /** Items whose code warning the host chose to keep (FR-023), by item ID, with the kept text's hash. */
  codeWarningAcks: Readonly<Record<string, string | null | undefined>>;
}

export interface PublishCheckResult {
  ready: boolean;
  blockers: PublishBlocker[];
  leftOut: { sectionId: string; itemIds: string[] }[];
  warnings: PublishWarning[];
}

/**
 * Phrases and link hosts that ask guests to book or pay outside the platform (PC-06). Matched on
 * folded text; warnings only, so a false positive costs one tap.
 */
const OFF_PLATFORM_PHRASES = [
  "reserva directo",
  "reserva directamente",
  "reservar directo",
  "reservar directamente",
  "reserve directo",
  "reservas directas",
  "reserva con nosotros",
  "descuento si reservas",
  "fuera de airbnb",
  "fuera de la plataforma",
  "pagame por",
  "pago por sinpe",
  "sinpe movil",
  "transferencia bancaria",
  "deposito bancario",
  "western union",
  "whatsapp para reservar",
  "book direct",
  "book directly",
  "book with us directly",
  "direct booking",
  "off airbnb",
  "outside airbnb",
  "outside the platform",
  "pay me via",
  "pay me through",
  "wire transfer",
  "bank transfer",
  "whatsapp to book",
  "venmo",
  "zelle",
  "cash app",
  "paypal",
];
const OFF_PLATFORM_HOSTS = [
  "paypal.me",
  "paypal.com",
  "venmo.com",
  "wise.com",
  "cash.app",
  "zellepay.com",
];

const offPlatformPatterns = OFF_PLATFORM_PHRASES.map(
  (phrase) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${phrase.replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "u"),
);

/** True when text asks guests to book or pay outside the platform (PC-06); also used by spec 004. */
export function asksOffPlatform(text: string): boolean {
  const folded = foldForMatch(text);
  return offPlatformPatterns.some((pattern) => pattern.test(folded));
}

function linkIsOffPlatform(href: string): boolean {
  try {
    const host = new URL(href).hostname.toLowerCase();
    return OFF_PLATFORM_HOSTS.some(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`),
    );
  } catch {
    return false;
  }
}

/** FNV-1a, 32 bits, hex: the hash stored when the host keeps text despite a code warning. */
export function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Runs the publish check. */
export function checkPublish(input: PublishCheckInput): PublishCheckResult {
  const blockers: PublishBlocker[] = [];
  if (!input.setupReady) blockers.push("not_ready");
  if (!input.workspaceActive) blockers.push("pending_deletion");

  const leftOut: { sectionId: string; itemIds: string[] }[] = [];
  const warnings: PublishWarning[] = [];
  const referenced = new Set<string>();
  let unreviewed = 0;
  let outOfDate = 0;

  for (const section of input.sections) {
    if (section.hidden) continue;
    const pending = section.items.filter((item) => !item.reviewed).map((item) => item.id);
    if (pending.length > 0) leftOut.push({ sectionId: section.id, itemIds: pending });
    for (const item of section.items) {
      if (!item.reviewed) continue;
      const texts = input.languages
        .map((language) => ({ language, text: item.texts[language] }))
        .filter((entry) => entry.text?.doc);
      for (const { language, text } of texts) {
        if (language === item.sourceLanguage || !text) continue;
        if (text.origin === "machine" && text.state === "current") unreviewed += 1;
        if (text.state === "out_of_date") outOfDate += 1;
      }
      const plain = texts.map((entry) => docPlainText(entry.text?.doc)).join("\n");
      const references = texts.map((entry) => docReferences(entry.text?.doc));
      for (const ref of references) for (const field of ref.fields) referenced.add(field);
      const sourcePlain = docPlainText(item.texts[item.sourceLanguage]?.doc);
      if (
        sourcePlain &&
        containsRestrictedValue(sourcePlain) &&
        input.codeWarningAcks[item.id] !== textHash(sourcePlain)
      ) {
        warnings.push({ kind: "code_like_text", sectionId: section.id, itemId: item.id });
      }
      const folded = foldForMatch(
        [plain, item.recommendation?.name, item.recommendation?.url].filter(Boolean).join("\n"),
      );
      const links = references.flatMap((ref) => ref.links);
      if (item.recommendation?.url) links.push(item.recommendation.url);
      if (
        offPlatformPatterns.some((pattern) => pattern.test(folded)) ||
        links.some(linkIsOffPlatform)
      ) {
        warnings.push({ kind: "off_platform", sectionId: section.id, itemId: item.id });
      }
    }
  }

  for (const topicId of ESSENTIAL_TOPICS) {
    const topic = guideTopic(topicId);
    if (!topic) continue;
    const state = input.completeness.sections[topic.section]?.topics[topicId];
    if (state === "missing")
      warnings.push({ kind: "missing_essential", topicId, sectionKind: topic.section });
  }
  const setFields = new Set(
    input.lockedFields.filter((field) => field.isSet).map((field) => field.id),
  );
  for (const fieldId of referenced) {
    if (!setFields.has(fieldId)) warnings.push({ kind: "unset_locked_field", fieldId });
  }
  if (unreviewed > 0) warnings.push({ kind: "unreviewed_translations", count: unreviewed });
  if (outOfDate > 0) warnings.push({ kind: "out_of_date_translations", count: outOfDate });

  return { ready: blockers.length === 0, blockers, leftOut, warnings };
}
