import type { ListingExtraction } from "./extraction/schema.js";
import {
  LlmTimeoutError,
  LlmUnavailableError,
  type LlmExtractionResult,
  type LlmPort,
} from "./port.js";

export interface FakeLlmOptions {
  /** A fixed answer; otherwise a simple deterministic reading of the text. */
  result?: ListingExtraction | null;
  /** Waits this long first, to test the 60-second deadline. */
  delayMs?: number;
  /** Simulates the provider being down. */
  unavailable?: boolean;
}

const HEADINGS = {
  houseRules: /^(house rules|normas de la casa|reglas de la casa|normas)\s*:?\s*$/i,
  amenities: /^(amenities|comodidades|servicios|lo que ofrece este lugar)\s*:?\s*$/i,
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
  const time = (pattern: RegExp) => {
    const match = pattern.exec(text);
    return match ? `${match[1]!.padStart(2, "0")}:${match[2] ?? "00"}` : null;
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
      time(/check-?in[^0-9]{0,20}(\d{1,2})(?::(\d{2}))?/i) ??
      time(/entrada[^0-9]{0,20}(\d{1,2})(?::(\d{2}))?/i),
    checkoutTime:
      time(/check-?out[^0-9]{0,20}(\d{1,2})(?::(\d{2}))?/i) ??
      time(/salida[^0-9]{0,20}(\d{1,2})(?::(\d{2}))?/i),
    maxGuests: guests ? Number(guests[1]) : null,
  };
}

/**
 * The fake model for development and tests (LLM_MODE=fake, refused in production). It records
 * every input it receives, so tests can prove that codes and images never reach the model
 * (AC-SEC-003, AC-SEC-014).
 */
export class FakeLlmAdapter implements LlmPort {
  readonly calls: string[] = [];

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
}
