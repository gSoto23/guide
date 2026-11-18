import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import {
  emergencyNumberFor,
  renderKnowledge,
  type GuideSnapshot,
  type Knowledge,
} from "@guidesk/domain";

/**
 * Golden cases for the assistant (feature 005 research R13): two fictional guides and the
 * conversations to score. Locked values exist only here, to prove they never reach a reply; the
 * knowledge the model sees has their labels, as in production (SEC-06).
 */
export class CaseError extends Error {}

export interface EvalGuide {
  id: string;
  propertyName: string;
  hostName: string;
  language: "es" | "en";
  country: string;
  facts: {
    checkInTime: string | null;
    checkoutTime: string | null;
    maxGuests: number | null;
    address: string | null;
  };
  locked: { id: string; label: string; secret: string }[];
  sections: {
    kind: string;
    texts: string[];
    recommendation?: { name: string; category: string; url?: string; benefit?: string };
  }[];
}

export type CaseKind =
  | "answerable"
  | "language"
  | "escalation"
  | "sensitive"
  | "injection"
  | "greeting"
  | "out_of_scope"
  // Feature 007 (research R15).
  | "clarify"
  | "general"
  | "tone"
  | "instructions";

export interface EvalCase {
  id: string;
  guide: string;
  kind: CaseKind;
  message: string;
  history?: { role: "guest" | "assistant" | "host"; text: string }[];
  /** Feature 007: the topic's level (default `auto`), the tone, and the host's instructions. */
  settings?: {
    level?: "draft" | "auto" | "full_auto";
    tone?: "casual" | "formal";
    instructions?: { workspace?: string; property?: string };
  };
  expect: {
    /** Feature 007: the answer's kind and what happens to it. */
    kind?: "grounded" | "general" | "clarify";
    decision?: "answered" | "drafted" | "hold" | "pointer" | "greeting";
    /** Spanish formal tone: no "tú" forms, no exclamation marks or emoji. */
    formal?: boolean;
    /** Words the reply must contain (lowercase match), such as a followed preference. */
    mentions?: string[];
    sectionKind?: string;
    language?: string;
    escalation?: string;
    topic?: string;
    injection?: boolean;
    answerable?: boolean;
    forbidden?: string[];
  };
}

export interface LoadedGuide {
  guide: EvalGuide;
  knowledge: Knowledge;
  /** Section ID by kind, to check citations. */
  sectionByKind: Map<string, string>;
}

const require = createRequire(import.meta.url);
type GuestCatalog = { sections: Record<string, string> };
const TITLES: Record<"es" | "en", Record<string, string>> = {
  es: (require("@guidesk/i18n/messages/guest.es.json") as GuestCatalog).sections,
  en: (require("@guidesk/i18n/messages/guest.en.json") as GuestCatalog).sections,
};

/** A paragraph document; `[[field-id]]` becomes a locked-field node, as the editor stores it. */
function doc(text: string) {
  const content: object[] = [];
  for (const part of text.split(/(\[\[[^\]]+\]\])/)) {
    if (!part) continue;
    const field = /^\[\[([^\]]+)\]\]$/.exec(part);
    content.push(
      field ? { type: "lockedField", attrs: { fieldId: field[1] } } : { type: "text", text: part },
    );
  }
  return { type: "doc", content: [{ type: "paragraph", content }] };
}

export function loadGuideKnowledge(guide: EvalGuide): LoadedGuide {
  const snapshot = {
    schema: 1,
    languages: [guide.language],
    sections: guide.sections.map((section, index) => ({
      id: `s${index + 1}-${section.kind}`,
      kind: section.kind,
      items: [
        ...section.texts.map((text, item) => ({
          id: `i${index + 1}-${item + 1}`,
          kind: "text",
          sourceLanguage: guide.language,
          texts: { [guide.language]: doc(text) },
        })),
        ...(section.recommendation
          ? [
              {
                id: `i${index + 1}-rec`,
                kind: "recommendation",
                sourceLanguage: guide.language,
                texts: {},
                recommendation: { personalTip: false, ...section.recommendation },
              },
            ]
          : []),
      ],
    })),
  } as unknown as GuideSnapshot;
  const titles = TITLES[guide.language];
  const knowledge = renderKnowledge({
    snapshot,
    language: guide.language,
    propertyName: guide.propertyName,
    facts: guide.facts,
    lockedLabels: new Map(guide.locked.map((field) => [field.id, field.label])),
    publicValues: new Map(),
    sectionTitle: (kind, custom) => custom ?? titles[kind] ?? kind,
    emergencyNumber: emergencyNumberFor(guide.country),
  });
  for (const field of guide.locked) {
    if (knowledge.text.includes(field.secret)) {
      throw new CaseError(`Guide ${guide.id}: a locked value reached the knowledge`);
    }
  }
  return {
    guide,
    knowledge,
    sectionByKind: new Map(knowledge.sections.map((section) => [section.kind, section.id])),
  };
}

export async function loadCases(dir: string): Promise<{
  guides: Map<string, LoadedGuide>;
  cases: EvalCase[];
}> {
  const guides = new Map<string, LoadedGuide>();
  for (const name of ["casa-colibri", "villa-mar"]) {
    const guide = JSON.parse(
      await readFile(path.join(dir, "guides", `${name}.json`), "utf8"),
    ) as EvalGuide;
    guides.set(guide.id, loadGuideKnowledge(guide));
  }
  const cases = JSON.parse(
    await readFile(path.join(dir, "conversations.json"), "utf8"),
  ) as EvalCase[];
  for (const testCase of cases) {
    if (!guides.has(testCase.guide)) throw new CaseError(`${testCase.id}: unknown guide`);
  }
  return { guides, cases };
}
