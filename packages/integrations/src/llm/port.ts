import type {
  AnswerGuestInput,
  GuestAnswer,
  GuestClassification,
  GuestClassificationInput,
} from "./agent/schemas.js";
import type { ListingExtraction } from "./extraction/schema.js";
import type {
  DraftAnswer,
  DraftAnswerInput,
  DraftFromListingInput,
  DraftItems,
  SuggestFromDocumentInput,
  TranslateBlocksInput,
  TranslatedBlocks,
} from "./guide/schemas.js";

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

/** The outcome of a structured call; `refused`, `truncated`, and `invalid` carry no result. */
export interface LlmCallResult<T> {
  outcome: "ok" | "refused" | "truncated" | "invalid";
  result: T | null;
  usage: ExtractionUsage;
  model: string;
}

export interface LlmCallOptions {
  signal?: AbortSignal;
}

/**
 * The guide builder's calls (feature 003 research R6). Every input has passed the restricted-value
 * detector (research R5); locked-field values never reach these calls, and neither do images or
 * audio.
 */
export interface GuideLlmPort {
  draftFromListing(
    input: DraftFromListingInput,
    options?: LlmCallOptions,
  ): Promise<LlmCallResult<DraftItems>>;
  draftAnswer(
    input: DraftAnswerInput,
    options?: LlmCallOptions,
  ): Promise<LlmCallResult<DraftAnswer>>;
  suggestFromDocument(
    input: SuggestFromDocumentInput,
    options?: LlmCallOptions,
  ): Promise<LlmCallResult<DraftItems>>;
  translateBlocks(
    input: TranslateBlocksInput,
    options?: LlmCallOptions,
  ): Promise<LlmCallResult<TranslatedBlocks>>;
}

/** Token use of an assistant call, with cache reads and writes for the trace (feature 005 FR-030). */
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsdMicros: number;
}

export interface AgentCallResult<T> {
  outcome: "ok" | "refused" | "truncated" | "invalid";
  result: T | null;
  usage: AgentUsage;
  model: string;
}

/**
 * The guest assistant's calls (feature 005 research R3). Classification never sees the guide; the
 * answer sees only the published guide as rendered knowledge, with locked fields as labels.
 */
export interface AgentLlmPort {
  classifyGuestMessage(
    input: GuestClassificationInput,
    options?: LlmCallOptions,
  ): Promise<AgentCallResult<GuestClassification>>;
  answerGuest(
    input: AnswerGuestInput,
    options?: LlmCallOptions,
  ): Promise<AgentCallResult<GuestAnswer>>;
}

export interface LlmPort extends GuideLlmPort, AgentLlmPort {
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
