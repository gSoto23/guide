import type { GuideSnapshot } from "../guides/snapshot.js";

/**
 * Copilot rules for platform chats (feature 006 research R5, PC-05, PC-10). Every function runs in
 * one pass over its input: no backtracking pattern ever sees model or pasted text.
 */
export const REMOVABLE = ["link", "email", "phone"] as const;
export type Removable = (typeof REMOVABLE)[number];

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
const LEADING = new Set("(\"'«“¿¡<[");
const TRAILING = new Set(")\"'».,;:!?”>]");
const PHONE_CHARS = new Set("0123456789 ().-+");

function core(word: string): string {
  let start = 0;
  let end = word.length;
  while (start < end && LEADING.has(word[start]!)) start += 1;
  while (end > start && TRAILING.has(word[end - 1]!)) end -= 1;
  return word.slice(start, end);
}

export function isLinkWord(raw: string): boolean {
  const word = core(raw).toLowerCase();
  if (word.startsWith("http://") || word.startsWith("https://") || word.startsWith("www.")) {
    return true;
  }
  if (word.includes("@")) return false;
  const labels = word.split(".");
  if (labels.length < 2) return false;
  const tld = labels.at(-1)!.split("/")[0]!;
  return TLDS.has(tld) && labels.slice(0, -1).every((label) => /^[a-z0-9-]+$/.test(label));
}

export function isEmailWord(raw: string): boolean {
  const word = core(raw);
  const at = word.indexOf("@");
  return at > 0 && word.indexOf(".", at + 2) > at + 1 && word.lastIndexOf(".") < word.length - 1;
}

/** Spans of phone-like runs: at least 7 digits with a group of 3 or more (times have short groups). */
function phoneSpans(text: string): [number, number][] {
  const spans: [number, number][] = [];
  let start = -1;
  let digits = 0;
  let group = 0;
  let longest = 0;
  const close = (end: number) => {
    if (start >= 0 && digits >= 7 && longest >= 3) {
      let last = end;
      while (last > start && !/[0-9)]/.test(text[last - 1]!)) last -= 1;
      spans.push([start, last]);
    }
    start = -1;
    digits = 0;
    group = 0;
    longest = 0;
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (!PHONE_CHARS.has(char)) {
      close(index);
      continue;
    }
    const isDigit = char >= "0" && char <= "9";
    if (start < 0) {
      if (!isDigit && char !== "+" && char !== "(") continue;
      start = index;
    }
    if (isDigit) {
      digits += 1;
      group += 1;
      longest = Math.max(longest, group);
    } else {
      group = 0;
    }
  }
  close(text.length);
  return spans;
}

/**
 * PC-05: before booking, drafts carry no link, email address, or phone number. Returns the text
 * without them and which kinds were removed.
 */
export function removeContactDetails(text: string): { text: string; removed: Removable[] } {
  const removed = new Set<Removable>();
  const kept: string[] = [];
  for (const part of text.split(/(\s+)/)) {
    if (part.trim() === "") {
      kept.push(part);
    } else if (isEmailWord(part)) {
      removed.add("email");
    } else if (isLinkWord(part)) {
      removed.add("link");
    } else {
      kept.push(part);
    }
  }
  let result = kept.join("");
  const spans = phoneSpans(result);
  if (spans.length > 0) {
    removed.add("phone");
    for (const [start, end] of spans.reverse()) result = result.slice(0, start) + result.slice(end);
  }
  // Tidy the gaps the removals left: repeated spaces and spaces before punctuation.
  result = result
    .split("\n")
    .map((line) => line.split(" ").filter(Boolean).join(" "))
    .join("\n")
    .replaceAll(" .", ".")
    .replaceAll(" ,", ",")
    .replaceAll(" :", ":")
    .trim();
  return { text: result, removed: REMOVABLE.filter((kind) => removed.has(kind)) };
}

/** PC-10: recommendations that declare a commission, discount, or other benefit stay out of copilot drafts. */
export function withoutBenefitRecommendations(snapshot: GuideSnapshot): GuideSnapshot {
  return {
    ...snapshot,
    sections: snapshot.sections.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.recommendation?.benefit || item.recommendation.benefit === "none",
      ),
    })),
  };
}
