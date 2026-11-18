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

const LINK_PATTERNS = [
  /https?:\/\//i,
  /(?<![\p{L}\p{N}])www\./iu,
  /(?<![\p{L}\p{N}@.])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|cr|es|mx|info|app|dev|me|ly|gl|link|site|online|shop|travel)(?![\p{L}\p{N}])/iu,
];
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().-]{5,}\d/g;

function hasPhone(text: string): boolean {
  for (const candidate of text.match(PHONE_CANDIDATE) ?? []) {
    const digits = candidate.replace(/\D/g, "");
    // Times and ranges such as 10.30-11.30 have only short groups; phone numbers have a group of 3+.
    if (digits.length >= 7 && /\d{3,}/.test(candidate)) return true;
  }
  return false;
}

/** The reasons a text can't be saved as instructions, in a stable order; empty when it can. */
export function instructionIssues(text: string): InstructionIssue[] {
  const issues: InstructionIssue[] = [];
  if ([...text].length > INSTRUCTIONS_MAX) issues.push("too_long");
  if (containsRestrictedValue(text)) issues.push("restricted_value");
  if (LINK_PATTERNS.some((pattern) => pattern.test(text))) issues.push("link");
  if (EMAIL_PATTERN.test(text)) issues.push("email");
  if (hasPhone(text)) issues.push("phone");
  if (asksOffPlatform(text)) issues.push("off_platform");
  return issues;
}
