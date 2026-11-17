import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ListingExtraction } from "@guidesk/integrations";
import { expectationProblems, forbiddenInText } from "./score.js";

/**
 * Eval cases for listing extraction (research R6, SC-002, constitution V). One JSON file per
 * case: `cases/listings/*.json` holds the synthetic listings with expected fields, and
 * `cases/injection/*.json` the prompt-injection cases (FR-014, AC-SEC-004). Every text is written
 * for the suite (the repository is public): fictional places, names, phone numbers, and codes.
 *
 * Validation is strict (unknown keys, formats, and that every expectation is written in the
 * listing itself) so a typo cannot quietly weaken the suite.
 */

/** The extraction fields, in the order of `listingExtractionSchema`. */
export const FIELDS = [
  "language",
  "title",
  "description",
  "houseRules",
  "amenities",
  "checkInTime",
  "checkoutTime",
  "maxGuests",
] as const satisfies readonly (keyof ListingExtraction)[];
export type Field = (typeof FIELDS)[number];

export const CASE_LANGUAGES = ["es", "en"] as const;
export type CaseLanguage = (typeof CASE_LANGUAGES)[number];

/**
 * What a correct extraction contains. `null` means the listing does not state it, so any value
 * the model returns is an invented fact (FR-010).
 * - `language`, `checkInTime`, `checkoutTime`, `maxGuests`: exact values.
 * - `title`: the title as written (accent-, case-, and punctuation-insensitive).
 * - `description`, `houseRules`: key phrases that must all appear in that field.
 * - `amenities`: labels that must all be present among the returned amenities.
 */
export interface ExpectedFields {
  language: CaseLanguage;
  title: string | null;
  description: string[] | null;
  houseRules: string[] | null;
  amenities: string[] | null;
  checkInTime: string | null;
  checkoutTime: string | null;
  maxGuests: number | null;
}

interface CaseBase {
  id: string;
  /** Path relative to `cases/`, for messages. */
  file: string;
  language: CaseLanguage;
  text: string;
  /** Codes in the text that the detector must remove before the model (research R4, SC-003). */
  restricted: string[];
}

export interface ListingCase extends CaseBase {
  kind: "listing";
  /** Every field is stated, with `null` when the listing does not state it. */
  expected: ExpectedFields;
}

export interface InjectionCase extends CaseBase {
  kind: "injection";
  /**
   * Text that must not appear in any field. Only an obedient model would write it, so it must
   * not appear in the listing text itself.
   */
  forbidden: string[];
  /**
   * Text that must not appear in one field, for injected content the listing may legitimately
   * contain elsewhere (a URL may come back only as listing text, AC-SEC-004).
   */
  forbiddenInField: Partial<Record<Field, string[]>>;
  /** Fields that must still be extracted correctly despite the attack. */
  expected: Partial<ExpectedFields>;
}

export type EvalCase = ListingCase | InjectionCase;

export interface Suite {
  listings: ListingCase[];
  injections: InjectionCase[];
}

/** SC-002: 30 listings, 15 per language; R6: 5 injection cases. More may be added. */
const MIN_LISTINGS_PER_LANGUAGE = 15;
const MIN_INJECTIONS = 5;
const MAX_TEXT_LENGTH = 20_000; // FR-009
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaseError";
  }
}

function fail(where: string, message: string): never {
  throw new CaseError(`${where}: ${message}`);
}

function readObject(
  value: unknown,
  where: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(where, "must be an object");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(where, `unknown key "${key}"`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(where, "must be a non-empty string");
  return value;
}

function readStrings(value: unknown, where: string, options: { allowEmpty: boolean }): string[] {
  if (!Array.isArray(value)) fail(where, "must be a list of strings");
  if (!options.allowEmpty && value.length === 0) fail(where, "must not be empty");
  return value.map((item, index) => readString(item, `${where}[${index}]`));
}

function readLanguage(value: unknown, where: string): CaseLanguage {
  const language = CASE_LANGUAGES.find((candidate) => candidate === value);
  if (!language) fail(where, `must be one of ${CASE_LANGUAGES.join(", ")}`);
  return language;
}

function readTime(value: unknown, where: string): string {
  if (typeof value !== "string" || !TIME.test(value)) fail(where, "must be HH:MM (24-hour)");
  return value;
}

function readGuests(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(where, "must be a positive whole number");
  }
  return value;
}

function nullable<T>(value: unknown, where: string, read: (value: unknown, where: string) => T) {
  return value === null ? null : read(value, where);
}

/** Reads `expected`; for listings every field is required, for injection cases each is optional. */
function readExpected(value: unknown, where: string, complete: true): ExpectedFields;
function readExpected(value: unknown, where: string, complete: false): Partial<ExpectedFields>;
function readExpected(value: unknown, where: string, complete: boolean): Partial<ExpectedFields> {
  const record = readObject(value, where, FIELDS);
  if (complete) {
    for (const field of FIELDS) {
      if (!(field in record)) {
        fail(where, `"${field}" is required (use null when the listing does not state it)`);
      }
    }
  }
  const expected: Partial<ExpectedFields> = {};
  const at = (field: Field) => `${where}.${field}`;
  if ("language" in record) expected.language = readLanguage(record.language, at("language"));
  if ("title" in record) expected.title = nullable(record.title, at("title"), readString);
  for (const field of ["description", "houseRules", "amenities"] as const) {
    if (field in record) {
      expected[field] = nullable(record[field], at(field), (item, itemWhere) =>
        readStrings(item, itemWhere, { allowEmpty: false }),
      );
    }
  }
  for (const field of ["checkInTime", "checkoutTime"] as const) {
    if (field in record) expected[field] = nullable(record[field], at(field), readTime);
  }
  if ("maxGuests" in record) {
    expected.maxGuests = nullable(record.maxGuests, at("maxGuests"), readGuests);
  }
  return expected;
}

function readForbiddenInField(value: unknown, where: string): Partial<Record<Field, string[]>> {
  const record = readObject(value, where, FIELDS);
  const result: Partial<Record<Field, string[]>> = {};
  for (const field of FIELDS) {
    if (field in record) {
      result[field] = readStrings(record[field], `${where}.${field}`, { allowEmpty: false });
    }
  }
  return result;
}

function readBase(record: Record<string, unknown>, file: string): Omit<CaseBase, "file"> {
  const id = readString(record.id, `${file}: id`);
  if (!ID.test(id)) fail(file, "id must be lowercase letters, digits, and dashes");
  if (path.basename(file, ".json") !== id) fail(file, `id "${id}" must match the file name`);
  const text = readString(record.text, `${file}: text`);
  if (text.length > MAX_TEXT_LENGTH)
    fail(file, `text is longer than ${MAX_TEXT_LENGTH} characters`);
  const restricted =
    record.restricted === undefined
      ? []
      : readStrings(record.restricted, `${file}: restricted`, { allowEmpty: false });
  for (const value of restricted) {
    if (!text.includes(value)) fail(file, "a restricted value does not appear in the text");
  }
  return { id, language: readLanguage(record.language, `${file}: language`), text, restricted };
}

/** The expectations must be written in the listing, so the suite cannot reward invention. */
function checkAgainstText(file: string, expected: Partial<ExpectedFields>, text: string): void {
  const problems = expectationProblems(expected, text);
  if (problems.length > 0) fail(file, `expectation not found in the text: ${problems.join("; ")}`);
}

function parseListing(json: unknown, file: string): ListingCase {
  const record = readObject(json, file, ["id", "language", "text", "restricted", "expected"]);
  const base = readBase(record, file);
  const expected = readExpected(record.expected, `${file}: expected`, true);
  if (expected.language !== base.language) {
    fail(file, "expected.language must match the case language");
  }
  checkAgainstText(file, expected, base.text);
  return { kind: "listing", file, ...base, expected };
}

function parseInjection(json: unknown, file: string): InjectionCase {
  const record = readObject(json, file, [
    "id",
    "language",
    "text",
    "restricted",
    "forbidden",
    "forbiddenInField",
    "expected",
  ]);
  const base = readBase(record, file);
  const forbidden = readStrings(record.forbidden, `${file}: forbidden`, { allowEmpty: true });
  const forbiddenInField =
    record.forbiddenInField === undefined
      ? {}
      : readForbiddenInField(record.forbiddenInField, `${file}: forbiddenInField`);
  if (forbidden.length === 0 && Object.keys(forbiddenInField).length === 0) {
    fail(file, "needs at least one forbidden value");
  }
  for (const value of forbidden) {
    if (forbiddenInText(value, base.text)) {
      fail(file, `forbidden "${value}" appears in the text; use forbiddenInField instead`);
    }
  }
  const expected =
    record.expected === undefined ? {} : readExpected(record.expected, `${file}: expected`, false);
  if (expected.language !== undefined && expected.language !== base.language) {
    fail(file, "expected.language must match the case language");
  }
  checkAgainstText(file, expected, base.text);
  return { kind: "injection", file, ...base, forbidden, forbiddenInField, expected };
}

async function readDirectory<T>(
  casesDir: string,
  folder: string,
  parse: (json: unknown, file: string) => T,
): Promise<T[]> {
  const names = (await readdir(path.join(casesDir, folder)))
    .filter((name) => name.endsWith(".json"))
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const file = `${folder}/${name}`;
      let json: unknown;
      try {
        json = JSON.parse(await readFile(path.join(casesDir, file), "utf8"));
      } catch (error: unknown) {
        fail(file, `is not valid JSON (${error instanceof Error ? error.message : "unknown"})`);
      }
      return parse(json, file);
    }),
  );
}

/** Loads and validates every case; throws `CaseError` on the first problem. */
export async function loadSuite(casesDir: string): Promise<Suite> {
  const listings = await readDirectory(casesDir, "listings", parseListing);
  const injections = await readDirectory(casesDir, "injection", parseInjection);
  const seen = new Set<string>();
  for (const testCase of [...listings, ...injections]) {
    if (seen.has(testCase.id)) fail(testCase.file, `duplicate id "${testCase.id}"`);
    seen.add(testCase.id);
  }
  for (const language of CASE_LANGUAGES) {
    const count = listings.filter((testCase) => testCase.language === language).length;
    if (count < MIN_LISTINGS_PER_LANGUAGE) {
      fail("listings", `${count} ${language} listings; SC-002 needs ${MIN_LISTINGS_PER_LANGUAGE}`);
    }
  }
  if (injections.length < MIN_INJECTIONS) {
    fail("injection", `${injections.length} cases; research R6 needs ${MIN_INJECTIONS}`);
  }
  return { listings, injections };
}
