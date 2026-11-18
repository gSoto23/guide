import { asksOffPlatform } from "../guides/publish-checks.js";
import { containsRestrictedValue } from "../properties/restricted-values.js";

/**
 * Custom instructions (feature 007 research R11, FR-011, FR-012): the host's preferences for the
 * assistant, at most 1,000 characters per scope. A save is refused when the text could carry a code
 * or secret to the model (SEC-06), a link, contact data, or an off-platform request (PC-06).
 */
export const INSTRUCTIONS_MAX = 1000;

export const INSTRUCTION_ISSUES = [
  "too_long",
  "restricted_value",
  "link",
  "email",
  "phone",
  "off_platform",
] as const;
export type InstructionIssue = (typeof INSTRUCTION_ISSUES)[number];

const TLDS = new Set([
  "com",
  "net",
  "org",
  "io",
  "co",
  "cr",
  "es",
  "mx",
  "info",
  "app",
  "dev",
  "me",
  "ly",
  "gl",
  "link",
  "site",
  "online",
  "shop",
  "travel",
]);
const PHONE_CHARS = new Set("0123456789 ().-+");

const LEADING = new Set("(\"'«“¿¡");
const TRAILING = new Set(")\"'».,;:!?”");

/** Whitespace-separated words, with surrounding punctuation removed. Linear on any input. */
function words(text: string): string[] {
  const result: string[] = [];
  for (const raw of text.split(/\s/)) {
    let start = 0;
    let end = raw.length;
    while (start < end && LEADING.has(raw[start]!)) start += 1;
    while (end > start && TRAILING.has(raw[end - 1]!)) end -= 1;
    if (end > start) result.push(raw.slice(start, end));
  }
  return result;
}

function hasLink(text: string): boolean {
  const lower = text.toLowerCase();
  if (lower.includes("http://") || lower.includes("https://")) return true;
  for (const word of words(lower)) {
    if (word.startsWith("www.")) return true;
    // A bare domain such as casacolibri.com: dot-separated labels ending in a known TLD.
    const labels = word.split(".");
    if (labels.length < 2 || word.includes("@")) continue;
    const tld = labels.at(-1)!.split("/")[0]!;
    if (TLDS.has(tld) && labels.slice(0, -1).every((label) => /^[a-z0-9-]+$/.test(label))) {
      return true;
    }
  }
  return false;
}

function hasEmail(text: string): boolean {
  return words(text).some((word) => {
    const at = word.indexOf("@");
    return at > 0 && word.indexOf(".", at + 2) > at + 1 && word.lastIndexOf(".") < word.length - 1;
  });
}

/**
 * Runs of digits and phone separators with at least 7 digits and a group of 3 or more; times and
 * ranges such as 10.30-11.30 have only short groups. One pass over the text.
 */
function hasPhone(text: string): boolean {
  let digits = 0;
  let group = 0;
  let longest = 0;
  const flush = () => {
    const found = digits >= 7 && longest >= 3;
    digits = 0;
    group = 0;
    longest = 0;
    return found;
  };
  for (const char of text) {
    if (!PHONE_CHARS.has(char)) {
      if (flush()) return true;
      continue;
    }
    if (char >= "0" && char <= "9") {
      digits += 1;
      group += 1;
      longest = Math.max(longest, group);
    } else {
      group = 0;
    }
  }
  return flush();
}

/** The reasons a text can't be saved as instructions, in a stable order; empty when it can. */
export function instructionIssues(text: string): InstructionIssue[] {
  const issues: InstructionIssue[] = [];
  if ([...text].length > INSTRUCTIONS_MAX) issues.push("too_long");
  if (containsRestrictedValue(text)) issues.push("restricted_value");
  if (hasLink(text)) issues.push("link");
  if (hasEmail(text)) issues.push("email");
  if (hasPhone(text)) issues.push("phone");
  if (asksOffPlatform(text)) issues.push("off_platform");
  return issues;
}
