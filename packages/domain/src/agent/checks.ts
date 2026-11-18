import { foldForMatch } from "../guides/completeness.js";
import { asksOffPlatform } from "../guides/publish-checks.js";

/**
 * Output checks (feature 005 research R6, FR-020, AC-SEC-008): deterministic tests a reply must
 * pass before it reaches a guest automatically. Member replies get them as warnings (PC-14).
 */
export const OUTPUT_CHECKS = ["citation", "codes", "links", "promises", "off_platform"] as const;
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

export function promisesPass(text: string): boolean {
  const folded = foldForMatch(text);
  return !promisePatterns.some((pattern) => pattern.test(folded));
}

/** Every check for an assistant answer, in order. */
export function checkAnswer(
  answer: { text: string; sectionIds: readonly string[] },
  context: CheckContext,
): CheckResult[] {
  return [
    {
      check: "citation",
      passed:
        answer.sectionIds.length > 0 && answer.sectionIds.every((id) => context.sectionIds.has(id)),
    },
    { check: "codes", passed: codesPass(answer.text, context.knowledgeText) },
    { check: "links", passed: linksPass(answer.text, context) },
    { check: "promises", passed: promisesPass(answer.text) },
    { check: "off_platform", passed: !asksOffPlatform(answer.text) },
  ];
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
