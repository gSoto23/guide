import type { RestrictedValueKind } from "../properties/restricted-values.js";
import type { DefaultSectionKind, FactKey, GuideItemKind, SectionKind } from "./template.js";
import { DEFAULT_SECTION_KINDS } from "./template.js";
import { GUIDE_TOPICS, type GuideTopic, type TopicRule } from "./topics.js";

/**
 * Coverage and the completeness score (feature 003 FR-030 to FR-033, research R10). Pure and
 * deterministic: it runs in the API on every save, so it never needs an AI call.
 */
export interface CoverageItem {
  kind: GuideItemKind;
  /** Plain text of the item in every language it has (caption, description, or body). */
  texts: readonly string[];
  /** Topic IDs the AI tagged. */
  topics: readonly string[];
  /** Recommendations only. */
  personalTip?: boolean;
}

export interface CoverageSection {
  kind: SectionKind;
  hidden: boolean;
  /** The section's own items plus inherited shared blocks (FR-062). */
  items: readonly CoverageItem[];
}

export interface CoverageInput {
  sections: readonly CoverageSection[];
  /** Locked fields that are set, by kind (a public Wi-Fi password counts). */
  setLockedFieldKinds: readonly RestrictedValueKind[];
  /** Which core facts the property has. */
  facts: Partial<Record<FactKey, boolean>>;
  /** Host marks (FR-032). */
  marks: Readonly<Record<string, "covered" | "not_applicable">>;
}

export type TopicState = "covered" | "missing" | "not_applicable";

export interface SectionScore {
  kind: DefaultSectionKind;
  /** 0–100. */
  score: number;
  topics: Record<string, TopicState>;
}

export interface MissingTopic {
  topicId: string;
  sectionKind: DefaultSectionKind;
  weight: number;
}

export interface CompletenessResult {
  /** 0–100 over every visible default section. */
  guide: number;
  sections: Partial<Record<DefaultSectionKind, SectionScore>>;
  /** Missing topics of visible sections, heaviest first, then in template order (FR-033). */
  missing: MissingTopic[];
}

const COMBINING_MARKS = /\p{M}/gu;

export function foldForMatch(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase();
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const keywordPatterns = new Map<string, RegExp>();

function keywordPattern(word: string): RegExp {
  let pattern = keywordPatterns.get(word);
  if (!pattern) {
    const source = escape(foldForMatch(word)).replace(/ /g, "\\s+");
    pattern = new RegExp(`(?<![\\p{L}\\p{N}])${source}(?![\\p{L}\\p{N}])`, "u");
    keywordPatterns.set(word, pattern);
  }
  return pattern;
}

function ruleMatches(
  rule: TopicRule,
  section: CoverageSection,
  folded: string,
  input: CoverageInput,
): boolean {
  switch (rule.kind) {
    case "keywords":
      return rule.words.some((word) => keywordPattern(word).test(folded));
    case "lockedField":
      return rule.fieldKinds.some((kind) => input.setLockedFieldKinds.includes(kind));
    case "media":
      return section.items.some((item) =>
        (rule.mediaKinds as readonly string[]).includes(item.kind),
      );
    case "recommendations":
      return section.items.filter((item) => item.kind === "recommendation").length >= rule.min;
    case "personalTip":
      return section.items.some(
        (item) => item.kind === "recommendation" && item.personalTip === true,
      );
    case "fact":
      return input.facts[rule.factKey] === true;
    case "anyText":
      return section.items.some(
        (item) => item.kind === "text" && item.texts.some((text) => text.trim().length > 0),
      );
  }
}

function topicState(
  topic: GuideTopic,
  section: CoverageSection,
  folded: string,
  input: CoverageInput,
): TopicState {
  const mark = input.marks[topic.id];
  if (mark === "not_applicable") return "not_applicable";
  if (mark === "covered") return "covered";
  if (section.items.some((item) => item.topics.includes(topic.id))) return "covered";
  return topic.rules.some((rule) => ruleMatches(rule, section, folded, input))
    ? "covered"
    : "missing";
}

/** Scores a guide (FR-030) and lists what is missing (FR-033). */
export function computeCompleteness(input: CoverageInput): CompletenessResult {
  const sections: Partial<Record<DefaultSectionKind, SectionScore>> = {};
  const missing: MissingTopic[] = [];
  let coveredWeight = 0;
  let applicableWeight = 0;
  for (const kind of DEFAULT_SECTION_KINDS) {
    const section = input.sections.find((candidate) => candidate.kind === kind);
    if (!section || section.hidden) continue;
    const folded = foldForMatch(section.items.flatMap((item) => item.texts).join("\n"));
    let sectionCovered = 0;
    let sectionApplicable = 0;
    const topics: Record<string, TopicState> = {};
    for (const topic of GUIDE_TOPICS) {
      if (topic.section !== kind) continue;
      const state = topicState(topic, section, folded, input);
      topics[topic.id] = state;
      if (state === "not_applicable") continue;
      sectionApplicable += topic.weight;
      if (state === "covered") sectionCovered += topic.weight;
      else missing.push({ topicId: topic.id, sectionKind: kind, weight: topic.weight });
    }
    coveredWeight += sectionCovered;
    applicableWeight += sectionApplicable;
    sections[kind] = {
      kind,
      score: sectionApplicable === 0 ? 100 : Math.round((sectionCovered / sectionApplicable) * 100),
      topics,
    };
  }
  const order = new Map(GUIDE_TOPICS.map((topic, index) => [topic.id, index]));
  missing.sort(
    (a, b) => b.weight - a.weight || (order.get(a.topicId) ?? 0) - (order.get(b.topicId) ?? 0),
  );
  return {
    guide: applicableWeight === 0 ? 100 : Math.round((coveredWeight / applicableWeight) * 100),
    sections,
    missing,
  };
}
