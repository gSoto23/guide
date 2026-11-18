import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { GUIDE_SECTION_KINDS, type GuideSectionKindValue } from "@guidesk/integrations";

/**
 * Cases for the guide eval suites (feature 003 research R6, constitution V). One JSON file per
 * case. Every text is written for the suite (the repository is public): fictional places, names,
 * numbers, and codes.
 */
export interface Placement {
  /** A sentence of the input; the drafted text must keep its key words. */
  phrase: string;
  section: GuideSectionKindValue;
}

export interface DraftingCase {
  id: string;
  file: string;
  language: "es" | "en";
  description: string;
  expected: Placement[];
  /** Strings that must never appear in the model's output (injection cases). */
  forbidden: string[];
}

export class CaseError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDrafting(file: string, raw: unknown): DraftingCase {
  if (!isRecord(raw)) throw new CaseError(`${file}: not an object`);
  const { id, language, description, expected, forbidden = [] } = raw;
  if (
    typeof id !== "string" ||
    (language !== "es" && language !== "en") ||
    typeof description !== "string"
  ) {
    throw new CaseError(`${file}: id, language, and description are required`);
  }
  if (!Array.isArray(expected) || !Array.isArray(forbidden))
    throw new CaseError(`${file}: lists expected`);
  const placements = expected.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.phrase !== "string" || typeof entry.section !== "string") {
      throw new CaseError(`${file}: expected[${index}] needs phrase and section`);
    }
    if (!(GUIDE_SECTION_KINDS as readonly string[]).includes(entry.section)) {
      throw new CaseError(`${file}: expected[${index}] has an unknown section`);
    }
    if (!description.includes(entry.phrase)) {
      throw new CaseError(`${file}: expected[${index}] is not written in the description`);
    }
    return { phrase: entry.phrase, section: entry.section as GuideSectionKindValue };
  });
  return {
    id,
    file,
    language,
    description,
    expected: placements,
    forbidden: forbidden.filter((value): value is string => typeof value === "string"),
  };
}

/** Loads `cases/drafting` and `cases/injection`. */
export async function loadDrafting(casesDir: string): Promise<DraftingCase[]> {
  const cases: DraftingCase[] = [];
  for (const folder of ["drafting", "injection"]) {
    const dir = path.join(casesDir, folder);
    for (const name of (await readdir(dir)).filter((file) => file.endsWith(".json")).sort()) {
      const file = `${folder}/${name}`;
      cases.push(parseDrafting(file, JSON.parse(await readFile(path.join(dir, name), "utf8"))));
    }
  }
  return cases;
}

/** An interview answer (feature 003 T092, research R11): typed text or a voice transcript. */
export interface InterviewCase {
  id: string;
  file: string;
  language: "es" | "en";
  kind: "text" | "transcript";
  topicId: string;
  sectionKind: GuideSectionKindValue;
  answer: string;
  forbidden: string[];
}

function parseInterview(file: string, raw: unknown): InterviewCase {
  if (!isRecord(raw)) throw new CaseError(`${file}: not an object`);
  const { id, language, kind, topicId, sectionKind, answer, forbidden = [] } = raw;
  if (
    typeof id !== "string" ||
    (language !== "es" && language !== "en") ||
    (kind !== "text" && kind !== "transcript") ||
    typeof topicId !== "string" ||
    typeof answer !== "string" ||
    typeof sectionKind !== "string" ||
    !(GUIDE_SECTION_KINDS as readonly string[]).includes(sectionKind) ||
    !Array.isArray(forbidden)
  ) {
    throw new CaseError(
      `${file}: id, language, kind, topicId, sectionKind, and answer are required`,
    );
  }
  return {
    id,
    file,
    language,
    kind,
    topicId,
    sectionKind: sectionKind as GuideSectionKindValue,
    answer,
    forbidden: forbidden.filter((value): value is string => typeof value === "string"),
  };
}

/** Loads `cases/interview`. */
export async function loadInterview(casesDir: string): Promise<InterviewCase[]> {
  const dir = path.join(casesDir, "interview");
  const cases: InterviewCase[] = [];
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".json")).sort()) {
    const file = `interview/${name}`;
    cases.push(parseInterview(file, JSON.parse(await readFile(path.join(dir, name), "utf8"))));
  }
  return cases;
}

/** Blocks to translate (feature 003 T102, research R7), with words that must stay as written. */
export interface TranslationCase {
  id: string;
  file: string;
  from: "es" | "en";
  to: "es" | "en";
  blocks: string[];
  keep: string[];
}

function parseTranslation(file: string, raw: unknown): TranslationCase {
  if (!isRecord(raw)) throw new CaseError(`${file}: not an object`);
  const { id, from, to, blocks, keep = [] } = raw;
  const language = (value: unknown): value is "es" | "en" => value === "es" || value === "en";
  if (
    typeof id !== "string" ||
    !language(from) ||
    !language(to) ||
    from === to ||
    !Array.isArray(blocks) ||
    !blocks.every((block) => typeof block === "string" && block.trim()) ||
    !Array.isArray(keep)
  ) {
    throw new CaseError(`${file}: id, from, to, and blocks are required`);
  }
  return {
    id,
    file,
    from,
    to,
    blocks: blocks as string[],
    keep: keep.filter((value): value is string => typeof value === "string"),
  };
}

/** Loads `cases/translation`. */
export async function loadTranslation(casesDir: string): Promise<TranslationCase[]> {
  const dir = path.join(casesDir, "translation");
  const cases: TranslationCase[] = [];
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".json")).sort()) {
    const file = `translation/${name}`;
    cases.push(parseTranslation(file, JSON.parse(await readFile(path.join(dir, name), "utf8"))));
  }
  return cases;
}
