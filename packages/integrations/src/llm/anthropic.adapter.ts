import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { buildExtractionMessage, EXTRACTION_SYSTEM_PROMPT } from "./extraction/prompt.js";
import { listingExtractionSchema } from "./extraction/schema.js";
import {
  buildDraftAnswerMessage,
  buildDraftListingMessage,
  buildSuggestDocumentMessage,
  buildTranslateMessage,
  DRAFT_ANSWER_SYSTEM_PROMPT,
  DRAFT_LISTING_SYSTEM_PROMPT,
  SUGGEST_DOCUMENT_SYSTEM_PROMPT,
  TRANSLATE_SYSTEM_PROMPT,
} from "./guide/prompts.js";
import {
  draftAnswerSchema,
  draftItemsSchema,
  translatedBlocksSchema,
  type DraftAnswer,
  type DraftAnswerInput,
  type DraftFromListingInput,
  type DraftItems,
  type SuggestFromDocumentInput,
  type TranslateBlocksInput,
  type TranslatedBlocks,
} from "./guide/schemas.js";
import {
  LlmTimeoutError,
  LlmUnavailableError,
  type ExtractionUsage,
  type LlmCallOptions,
  type LlmCallResult,
  type LlmExtractionResult,
  type LlmPort,
} from "./port.js";

/** ADR-0005: the default model and the effort for listing extraction (research R6). */
export const EXTRACTION_MODEL = "claude-opus-5-5";
export const EXTRACTION_EFFORT = "low";
/** ADR-0005: guide drafting from listings, interviews, and documents uses medium effort (feature 003 R6). */
export const GUIDE_MODEL = "claude-opus-5-5";
export const GUIDE_DRAFT_EFFORT = "medium";
/** Translation keeps structure and meaning at low effort (feature 003 R6). */
export const GUIDE_TRANSLATE_EFFORT = "low";

/**
 * List prices in US dollars per million tokens, which equals millionths of a dollar per token,
 * from Anthropic's pricing (2026-11-16). Cache writes are not used by this call. A model not in
 * the table (a fallback) is priced like the default model and is an estimate.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
};

interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
}

export function usageCost(model: string, usage: UsageLike): ExtractionUsage {
  const price = PRICES[model] ?? PRICES[EXTRACTION_MODEL]!;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens + cacheRead,
    outputTokens: usage.output_tokens,
    costUsdMicros: Math.round(
      usage.input_tokens * price.input +
        cacheRead * price.cacheRead +
        usage.output_tokens * price.output,
    ),
  };
}

export interface AnthropicLlmOptions {
  apiKey: string;
  /** Injectable for contract tests that replay recorded responses. */
  client?: Anthropic;
  maxTokens?: number;
}

/**
 * Listing extraction with Claude (research R6, T055): one structured call with the model's
 * output limited to the schema, no tools, and the server-side refusal fallback from ADR-0005.
 * `stop_reason` is checked before the result is read. Errors never carry the listing text.
 */
export class AnthropicLlmAdapter implements LlmPort {
  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(options: AnthropicLlmOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 1 });
    this.maxTokens = options.maxTokens ?? 8000;
  }

  async extractListing(
    redactedText: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<LlmExtractionResult> {
    let response;
    try {
      // `create`, not `parse`: stop_reason is checked before the content is read (ADR-0005).
      response = await this.client.beta.messages.create(
        {
          model: EXTRACTION_MODEL,
          max_tokens: this.maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildExtractionMessage(redactedText) }],
          output_config: {
            effort: EXTRACTION_EFFORT,
            format: betaZodOutputFormat(listingExtractionSchema),
          },
        },
        { signal: options.signal },
      );
    } catch (error: unknown) {
      if (options.signal?.aborted || error instanceof Anthropic.APIUserAbortError) {
        throw new LlmTimeoutError();
      }
      const reason =
        error instanceof Anthropic.APIError ? `status ${error.status ?? "none"}` : "connection";
      throw new LlmUnavailableError(reason);
    }
    const usage = usageCost(response.model, response.usage);
    const base = { usage, model: response.model, result: null };
    if (response.stop_reason === "refusal") return { ...base, outcome: "refused" };
    if (response.stop_reason === "max_tokens") return { ...base, outcome: "truncated" };
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    let parsed;
    try {
      parsed = listingExtractionSchema.safeParse(JSON.parse(text));
    } catch {
      return { ...base, outcome: "invalid" };
    }
    if (!parsed.success) return { ...base, outcome: "invalid" };
    return { ...base, outcome: "ok", result: parsed.data };
  }

  // Feature 003 (research R6): the guide builder's structured calls.

  draftFromListing(
    input: DraftFromListingInput,
    options: LlmCallOptions = {},
  ): Promise<LlmCallResult<DraftItems>> {
    return this.structured(
      draftItemsSchema,
      DRAFT_LISTING_SYSTEM_PROMPT,
      buildDraftListingMessage(input),
      GUIDE_DRAFT_EFFORT,
      options,
    );
  }

  draftAnswer(
    input: DraftAnswerInput,
    options: LlmCallOptions = {},
  ): Promise<LlmCallResult<DraftAnswer>> {
    return this.structured(
      draftAnswerSchema,
      DRAFT_ANSWER_SYSTEM_PROMPT,
      buildDraftAnswerMessage(input),
      GUIDE_DRAFT_EFFORT,
      options,
    );
  }

  suggestFromDocument(
    input: SuggestFromDocumentInput,
    options: LlmCallOptions = {},
  ): Promise<LlmCallResult<DraftItems>> {
    return this.structured(
      draftItemsSchema,
      SUGGEST_DOCUMENT_SYSTEM_PROMPT,
      buildSuggestDocumentMessage(input),
      GUIDE_DRAFT_EFFORT,
      options,
    );
  }

  translateBlocks(
    input: TranslateBlocksInput,
    options: LlmCallOptions = {},
  ): Promise<LlmCallResult<TranslatedBlocks>> {
    return this.structured(
      translatedBlocksSchema,
      TRANSLATE_SYSTEM_PROMPT,
      buildTranslateMessage(input),
      GUIDE_TRANSLATE_EFFORT,
      options,
    );
  }

  /**
   * One structured call: the output limited to `schema`, no tools, the refusal fallback, and
   * `stop_reason` checked before the content is read (ADR-0005). Errors never carry the input.
   * The system prompt is cached, since it is the same for every call of a kind.
   */
  private async structured<T>(
    schema: z.ZodType<T>,
    system: string,
    user: string,
    effort: "low" | "medium",
    options: LlmCallOptions,
  ): Promise<LlmCallResult<T>> {
    let response;
    try {
      response = await this.client.beta.messages.create(
        {
          model: GUIDE_MODEL,
          max_tokens: this.maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: user }],
          output_config: { effort, format: betaZodOutputFormat(schema) },
        },
        { signal: options.signal },
      );
    } catch (error: unknown) {
      if (options.signal?.aborted || error instanceof Anthropic.APIUserAbortError) {
        throw new LlmTimeoutError();
      }
      const reason =
        error instanceof Anthropic.APIError ? `status ${error.status ?? "none"}` : "connection";
      throw new LlmUnavailableError(reason);
    }
    const usage = usageCost(response.model, response.usage);
    const base = { usage, model: response.model, result: null };
    if (response.stop_reason === "refusal") return { ...base, outcome: "refused" };
    if (response.stop_reason === "max_tokens") return { ...base, outcome: "truncated" };
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    let parsed;
    try {
      parsed = schema.safeParse(JSON.parse(text));
    } catch {
      return { ...base, outcome: "invalid" };
    }
    if (!parsed.success) return { ...base, outcome: "invalid" };
    return { ...base, outcome: "ok", result: parsed.data };
  }
}
