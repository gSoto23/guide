import { foldForMatch } from "../guides/completeness.js";
import { asksOffPlatform } from "../guides/publish-checks.js";
import type { AnswerKind } from "./policy.js";

/**
 * Output checks (feature 005 research R6, FR-020, AC-SEC-008): deterministic tests a reply must
 * pass before it reaches a guest automatically. Member replies get them as warnings (PC-14).
 */
export const OUTPUT_CHECKS = [
  "citation",
  "codes",
  "links",
  "promises",
  "off_platform",
  "price",
  "clarify",
] as const;
export type OutputCheck = (typeof OUTPUT_CHECKS)[number];

export interface CheckResult {
  check: OutputCheck;
  passed: boolean;
}

export interface CheckContext {
  knowledgeText: string;
  sectionIds: ReadonlySet<string>;
  guideOrigin: string;
}

const PROMISES = [
  "refund",
  "reimburse",
  "we will compensate",
  "i will compensate",
  "compensation",
  "discount",
  "free night",
  "change your dates",
  "extend your stay for free",
  "reembolso",
  "reembolsar",
  "te devolvemos",
  "compensacion",
  "compensar",
  "descuento",
  "noche gratis",
  "cambiar tus fechas",
  "cambiamos tus fechas",
];
const promisePatterns = PROMISES.map(
  (phrase) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${phrase.replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "u"),
);
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const DIGIT_RUN = /\d{4,}/g;

/** Drops trailing punctuation without a regular expression (linear on any input). */
function trimUrl(url: string): string {
  let end = url.length;
  while (end > 0 && ".,;:!?".includes(url[end - 1]!)) end -= 1;
  return url.slice(0, end);
}

function codesPass(text: string, knowledge: string): boolean {
  const known = knowledge.replace(/[\s-]/g, "");
  for (const run of text.replace(/(\d)[\s-](?=\d)/g, "$1").match(DIGIT_RUN) ?? []) {
    if (!known.includes(run)) return false;
  }
  return true;
}

function linksPass(text: string, context: CheckContext): boolean {
  for (const raw of text.match(URL_PATTERN) ?? []) {
    const url = trimUrl(raw);
    if (url.startsWith(context.guideOrigin)) continue;
    if (!context.knowledgeText.includes(url)) return false;
  }
  return true;
}

/** Feature 007 research R4: general answers never state a price. Every pattern is fixed width. */
const PRICE_PATTERNS = [/[$₡€£]\s?\d/u, /\d\s?[$₡€£]/u, /(?<!\p{L})(?:usd|crc|eur|us\$)\s?\d/u];
const CURRENCY_WORDS = /(?<!\p{L})(?:usd|crc|eur|dolares|dollars|colones|euros|pesos)(?!\p{L})/gu;

export function pricePass(text: string): boolean {
  const folded = foldForMatch(text);
  if (PRICE_PATTERNS.some((pattern) => pattern.test(folded))) return false;
  // "15 dólares": a currency word right after a number (one optional space).
  for (const match of folded.matchAll(CURRENCY_WORDS)) {
    const before = folded.slice(Math.max(0, match.index - 2), match.index);
    if (/\d\s?$/.test(before)) return false;
  }
  return true;
}

/** Feature 007 research R4: one short question, at most two sentences and 300 characters. */
export function clarifyPass(text: string): boolean {
  const trimmed = text.trim();
  const sentences = trimmed.split(/(?<=[.!?])\s+/).filter((part) => /[\p{L}\p{N}]/u.test(part));
  return [...trimmed].length <= 300 && trimmed.includes("?") && sentences.length <= 2;
}

export function promisesPass(text: string): boolean {
  const folded = foldForMatch(text);
  return !promisePatterns.some((pattern) => pattern.test(folded));
}

/**
 * Every check for an assistant answer, in order. Grounded answers must cite a published section;
 * general answers must state no price; clarifying questions must be one short question (feature
 * 007 research R4).
 */
export function checkAnswer(
  answer: { text: string; sectionIds: readonly string[]; kind?: AnswerKind },
  context: CheckContext,
): CheckResult[] {
  const kind = answer.kind ?? "grounded";
  const results: CheckResult[] = [];
  if (kind === "grounded") {
    results.push({
      check: "citation",
      passed:
        answer.sectionIds.length > 0 && answer.sectionIds.every((id) => context.sectionIds.has(id)),
    });
  }
  results.push(
    { check: "codes", passed: codesPass(answer.text, context.knowledgeText) },
    { check: "links", passed: linksPass(answer.text, context) },
    { check: "promises", passed: promisesPass(answer.text) },
    { check: "off_platform", passed: !asksOffPlatform(answer.text) },
  );
  if (kind === "general") results.push({ check: "price", passed: pricePass(answer.text) });
  if (kind === "clarify") results.push({ check: "clarify", passed: clarifyPass(answer.text) });
  return results;
}

/** Warnings for a member's own reply (PC-14): no citation needed, and their codes are their call. */
export function memberReplyWarnings(text: string, context: CheckContext): OutputCheck[] {
  const warnings: OutputCheck[] = [];
  if (!linksPass(text, context)) warnings.push("links");
  if (!promisesPass(text)) warnings.push("promises");
  if (asksOffPlatform(text)) warnings.push("off_platform");
  return warnings;
}

export function allPassed(results: readonly CheckResult[]): boolean {
  return results.every((result) => result.passed);
}
