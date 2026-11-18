import type { ListingExtraction } from "./extraction/schema.js";
import type {
  DraftAnswer,
  DraftAnswerInput,
  DraftedItem,
  DraftFromListingInput,
  DraftItems,
  GuideSectionKindValue,
  SuggestFromDocumentInput,
  TranslateBlocksInput,
  TranslatedBlocks,
} from "./guide/schemas.js";
import {
  LlmTimeoutError,
  LlmUnavailableError,
  type LlmCallOptions,
  type LlmCallResult,
  type LlmExtractionResult,
  type LlmPort,
} from "./port.js";

/** Where the fake model puts a paragraph, by keyword (feature 003, development only). */
const FAKE_SECTION_KEYWORDS: readonly [GuideSectionKindValue, string, RegExp][] = [
  ["parking", "parking.where", /\b(parqueo|estacionamiento|parking|garaje|garage)\b/i],
  [
    "local_recommendations",
    "local.groceries",
    /\b(supermercado|super|grocery|supermarket|market)\b/i,
  ],
  ["local_recommendations", "local.restaurants", /\b(restaurante|restaurant|soda|cafe)\b/i],
  ["wifi", "wifi.network", /\b(wi-?fi|internet|red)\b/i],
  ["appliances", "appliances.ac_heating", /\b(aire acondicionado|air conditioning|a\/c)\b/i],
  ["appliances", "appliances.laundry", /\b(lavadora|washer|washing machine|secadora|dryer)\b/i],
  ["arrival", "arrival.access_steps", /\b(llave|llaves|entrada|key|keys|check-?in)\b/i],
  ["checkout", "checkout.steps", /\b(salida|checkout|check-?out)\b/i],
  ["emergency", "emergency.contacts", /\b(emergencia|emergency|hospital|911)\b/i],
];

function fakeRoute(paragraph: string, fallback: GuideSectionKindValue): DraftedItem {
  for (const [sectionKind, topic, pattern] of FAKE_SECTION_KEYWORDS) {
    if (pattern.test(paragraph)) return { sectionKind, text: paragraph, topics: [topic] };
  }
  return { sectionKind: fallback, text: paragraph, topics: [] };
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** One call the fake model received, for "never reaches the AI" checks (SC-004). */
export interface FakeGuideCall {
  method: "draftFromListing" | "draftAnswer" | "suggestFromDocument" | "translateBlocks";
  input: unknown;
}

export interface FakeLlmOptions {
  /** A fixed answer; otherwise a simple deterministic reading of the text. */
  result?: ListingExtraction | null;
  /** Waits this long first, to test the 60-second deadline. */
  delayMs?: number;
  /** Simulates the provider being down. */
  unavailable?: boolean;
  /** Feature 003: the outcome every guide call returns (default `ok`). */
  guideOutcome?: "ok" | "refused" | "truncated" | "invalid";
  /** Feature 003: replaces translated blocks, to test token checks (research R7). */
  translate?: (blocks: readonly string[], to: "es" | "en") => string[];
}

const HEADINGS = {
  houseRules: /^(house rules|normas de la casa|reglas de la casa|normas)[\s:]*$/i,
  amenities: /^(amenities|comodidades|servicios|lo que ofrece este lugar)[\s:]*$/i,
};

/** A small, deterministic reading used in development and tests (LLM_MODE=fake). */
export function fakeExtraction(text: string): ListingExtraction {
  const lines = text.split("\n").map((line) => line.trim());
  const sections: Record<"description" | "houseRules" | "amenities", string[]> = {
    description: [],
    houseRules: [],
    amenities: [],
  };
  let section: keyof typeof sections = "description";
  let title: string | null = null;
  for (const line of lines) {
    if (!line) continue;
    if (HEADINGS.houseRules.test(line)) section = "houseRules";
    else if (HEADINGS.amenities.test(line)) section = "amenities";
    else if (title === null) title = line.slice(0, 120);
    else sections[section].push(line.replace(/^[-•*]\s*/, ""));
  }
  // "3 pm" is 15:00, "12 am" is 00:00; a bare hour is taken as written.
  const time = (pattern: RegExp) => {
    const match = pattern.exec(text);
    if (!match) return null;
    const meridiem = match[3]?.toLowerCase().replaceAll(".", "");
    let hour = Number(match[1]) % (meridiem ? 12 : 24);
    if (meridiem === "pm") hour += 12;
    return `${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`;
  };
  const guests = /(\d{1,2})\s*(guests|huéspedes|personas)/i.exec(text);
  const spanish = /\b(la|el|los|las|con|para|casa|huéspedes|playa)\b/i.test(text);
  return {
    language: title ? (spanish ? "es" : "en") : null,
    title,
    description: sections.description.join("\n") || null,
    houseRules: sections.houseRules.join("\n") || null,
    amenities: sections.amenities.length > 0 ? sections.amenities : null,
    checkInTime:
      time(/check-?in[^0-9]{0,20}(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i) ??
      time(/entrada[^0-9]{0,20}(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i),
    checkoutTime:
      time(/check-?out[^0-9]{0,20}(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i) ??
      time(/salida[^0-9]{0,20}(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i),
    maxGuests: guests ? Number(guests[1]) : null,
  };
}

/**
 * The fake model for development and tests (LLM_MODE=fake, refused in production). It records
 * every input it receives, so tests can prove that codes and images never reach the model
 * (AC-SEC-003, AC-SEC-014).
 */
export class FakeLlmAdapter implements LlmPort {
  /** Every input as text: extraction inputs as given, guide inputs as JSON. */
  readonly calls: string[] = [];
  readonly guideCalls: FakeGuideCall[] = [];

  constructor(private readonly options: FakeLlmOptions = {}) {}

  async extractListing(
    redactedText: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<LlmExtractionResult> {
    this.calls.push(redactedText);
    if (this.options.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.delayMs);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new LlmTimeoutError());
        });
      });
    }
    if (options.signal?.aborted) throw new LlmTimeoutError();
    if (this.options.unavailable) throw new LlmUnavailableError("fake");
    const result =
      this.options.result === undefined ? fakeExtraction(redactedText) : this.options.result;
    return {
      outcome: "ok",
      result,
      model: "fake",
      usage: {
        inputTokens: Math.ceil(redactedText.length / 4),
        outputTokens: 100,
        costUsdMicros: 0,
      },
    };
  }

  // Feature 003 (research R6): deterministic answers for development and tests.

  async draftFromListing(
    input: DraftFromListingInput,
    options: LlmCallOptions = {},
  ): Promise<LlmCallResult<DraftItems>> {
    return this.guide("draftFromListing", input, options, () => ({
      items: paragraphs(input.description).map((paragraph) => fakeRoute(paragraph, "amenities")),
    }));
  }

  async draftAnswer(
    input: DraftAnswerInput,
    options: LlmCallOptions = {},
  ): Promise<LlmCallResult<DraftAnswer>> {
    return this.guide("draftAnswer", input, options, () => {
      const text = input.answer.trim();
      return {
        items: text
          ? [
              {
                sectionKind: input.sectionKind,
                text: text.charAt(0).toUpperCase() + text.slice(1),
                topics: [input.topicId],
              },
            ]
          : [],
        followUp: null,
      };
    });
  }

  async suggestFromDocument(
    input: SuggestFromDocumentInput,
    options: LlmCallOptions = {},
  ): Promise<LlmCallResult<DraftItems>> {
    return this.guide("suggestFromDocument", input, options, () => ({
      items: paragraphs(input.text)
        .slice(0, 3)
        .map((paragraph) => fakeRoute(paragraph, "appliances")),
    }));
  }

  async translateBlocks(
    input: TranslateBlocksInput,
    options: LlmCallOptions = {},
  ): Promise<LlmCallResult<TranslatedBlocks>> {
    return this.guide("translateBlocks", input, options, () => ({
      blocks: this.options.translate
        ? this.options.translate(input.blocks, input.to)
        : input.blocks.map((block) => (block ? `[${input.to}] ${block}` : block)),
    }));
  }

  private async guide<T>(
    method: FakeGuideCall["method"],
    input: unknown,
    options: LlmCallOptions,
    answer: () => T,
  ): Promise<LlmCallResult<T>> {
    this.guideCalls.push({ method, input });
    const text = JSON.stringify(input);
    this.calls.push(text);
    if (this.options.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.options.delayMs);
        options.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new LlmTimeoutError());
        });
      });
    }
    if (options.signal?.aborted) throw new LlmTimeoutError();
    if (this.options.unavailable) throw new LlmUnavailableError("fake");
    const usage = { inputTokens: Math.ceil(text.length / 4), outputTokens: 100, costUsdMicros: 0 };
    const outcome = this.options.guideOutcome ?? "ok";
    if (outcome !== "ok") return { outcome, result: null, usage, model: "fake" };
    return { outcome: "ok", result: answer(), usage, model: "fake" };
  }
}
