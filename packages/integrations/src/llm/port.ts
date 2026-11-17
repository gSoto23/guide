import type { ListingExtraction } from "./extraction/schema.js";

/**
 * The language model behind listing extraction (research R6, ADR-0005). Only redacted text is
 * ever sent (research R4); images never reach the model (research R3).
 */
export interface ExtractionUsage {
  inputTokens: number;
  outputTokens: number;
  /** Cost in millionths of a US dollar, from the model's list prices. */
  costUsdMicros: number;
}

export interface LlmExtractionResult {
  /** `refused` and `truncated` carry no result; `invalid` means the output did not parse. */
  outcome: "ok" | "refused" | "truncated" | "invalid";
  result: ListingExtraction | null;
  usage: ExtractionUsage;
  /** The model that answered, which can differ from the requested one after a fallback. */
  model: string;
}

export interface LlmPort {
  extractListing(
    redactedText: string,
    options?: { signal?: AbortSignal },
  ): Promise<LlmExtractionResult>;
}

/** The call was aborted at the job's deadline (FR-016). */
export class LlmTimeoutError extends Error {
  constructor() {
    super("The model did not answer before the deadline");
    this.name = "LlmTimeoutError";
  }
}

/** The provider could not be reached or answered with an error. Never carries request data. */
export class LlmUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`The model is unavailable (${reason})`);
    this.name = "LlmUnavailableError";
  }
}
