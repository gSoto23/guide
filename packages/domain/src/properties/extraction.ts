import { TIME_OF_DAY } from "./core-facts.js";
import { containsRestrictedValue } from "./restricted-values.js";

/**
 * Listing extraction rules around the model call (feature 002 FR-010 to FR-019, research R6).
 * Inputs are redacted before the call (research R4); the output is checked again here.
 */

/** What the model returns; mirrors `listingExtractionSchema` in @guidesk/integrations. */
export interface ListingExtractionOutput {
  language: string | null;
  title: string | null;
  description: string | null;
  houseRules: string | null;
  amenities: string[] | null;
  checkInTime: string | null;
  checkoutTime: string | null;
  maxGuests: number | null;
}

export type ExtractedKind = "title" | "description" | "house_rules" | "amenities";

export interface ExtractedContentItem {
  kind: ExtractedKind;
  body: string | null;
  items: string[] | null;
  /** BCP 47 tag of the listing's language (FR-019). */
  language: string | null;
  /** A link the model kept as text; shown to the host for review, never followed (AC-SEC-004). */
  containsLink: boolean;
}

export interface ProposedFacts {
  checkInTime: string | null;
  checkoutTime: string | null;
  maxGuests: number | null;
}

export interface ExtractionOutcome {
  items: ExtractedContentItem[];
  proposedFacts: ProposedFacts;
  language: string | null;
  /** Items or amenities dropped because they looked like codes (FR-013). */
  droppedItems: number;
}

const URL = /^(?:https?:\/\/|www\.)\S+$/i;
const LINK = /(?:https?:\/\/|www\.)\S+/i;

/**
 * True when the input is only one or more URLs (FR-011). Guidesk never opens a listing page, so
 * such input gets a request for the text or screenshots, with no outbound request and no AI call.
 */
export function isUrlOnly(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => URL.test(token));
}

/** `HH:MM` 24-hour, or null; `9:30` becomes `09:30`. */
function timeOrNull(value: string | null): string | null {
  if (!value) return null;
  const padded = /^\d:\d\d$/.test(value.trim()) ? `0${value.trim()}` : value.trim();
  return TIME_OF_DAY.test(padded) ? padded : null;
}

/** Proposed facts for the confirmation step; anything outside the allowed ranges is left out. */
export function toProposedFacts(
  output: Pick<ListingExtractionOutput, "checkInTime" | "checkoutTime" | "maxGuests">,
): ProposedFacts {
  const guests = output.maxGuests;
  return {
    checkInTime: timeOrNull(output.checkInTime),
    checkoutTime: timeOrNull(output.checkoutTime),
    maxGuests:
      guests !== null && Number.isInteger(guests) && guests >= 1 && guests <= 50 ? guests : null,
  };
}

const LIMITS = { title: 120, body: 20_000, items: 200, item: 120 } as const;

function text(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Maps the model's output to content items and proposed facts, keeps links as plain text marked
 * for review, and runs the restricted-value detector again: anything that looks like a code is
 * dropped, never stored (FR-013, the second line of defense after the input redaction).
 */
export function processExtractionOutput(output: ListingExtractionOutput): ExtractionOutcome {
  const language = text(output.language, 35);
  const items: ExtractedContentItem[] = [];
  let droppedItems = 0;
  const addBody = (
    kind: Exclude<ExtractedKind, "amenities">,
    value: string | null,
    max: number,
  ) => {
    const body = text(value, max);
    if (!body) return;
    if (containsRestrictedValue(body)) {
      droppedItems += 1;
      return;
    }
    items.push({ kind, body, items: null, language, containsLink: LINK.test(body) });
  };
  addBody("title", output.title, LIMITS.title);
  addBody("description", output.description, LIMITS.body);
  addBody("house_rules", output.houseRules, LIMITS.body);

  const amenities: string[] = [];
  for (const amenity of output.amenities ?? []) {
    const label = text(amenity, LIMITS.item);
    if (!label) continue;
    if (containsRestrictedValue(label)) {
      droppedItems += 1;
      continue;
    }
    if (amenities.length < LIMITS.items) amenities.push(label);
  }
  if (amenities.length > 0) {
    items.push({
      kind: "amenities",
      body: null,
      items: amenities,
      language,
      containsLink: amenities.some((label) => LINK.test(label)),
    });
  }
  return { items, proposedFacts: toProposedFacts(output), language, droppedItems };
}
