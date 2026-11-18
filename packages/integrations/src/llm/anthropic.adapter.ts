import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  ANSWER_SYSTEM,
  answerUserPrompt,
  CLASSIFY_SYSTEM,
  classifyUserPrompt,
  knowledgeBlock,
} from "./agent/prompts.js";
import {
  guestAnswerSchema,
  guestClassificationSchema,
  type AnswerGuestInput,
  type GuestAnswer,
  type GuestClassification,
  type GuestClassificationInput,
} from "./agent/schemas.js";
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
  type AgentCallResult,
  type AgentUsage,
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
/** ADR-0005: the guest assistant classifies and answers at low effort (feature 005 research R3). */
export const AGENT_MODEL = "claude-opus-5-5";
export const AGENT_EFFORT = "low";
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

/**
 * Cost of an assistant call with cache detail (feature 005 FR-030): cache writes at 1.25 times the
 * input price (5-minute cache), cache reads at the cache-read price.
 */
export function agentUsage(
  model: string,
  usage: UsageLike & { cache_creation_input_tokens?: number | null },
): AgentUsage {
  const price = PRICES[model] ?? PRICES[AGENT_MODEL]!;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    costUsdMicros: Math.round(
      usage.input_tokens * price.input +
        cacheRead * price.cacheRead +
        cacheWrite * price.input * 1.25 +
        usage.output_tokens * price.output,
    ),
  };
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

  async translateBlocks(
    input: TranslateBlocksInput,
    options: LlmCallOptions = {},
  ): Promise<LlmCallResult<TranslatedBlocks>> {
    const result = await this.structured(
      translatedBlocksSchema,
      TRANSLATE_SYSTEM_PROMPT,
      buildTranslateMessage(input),
      GUIDE_TRANSLATE_EFFORT,
      options,
    );
    // One string per block, or the answer cannot be matched back to its blocks (research R7).
    if (result.outcome === "ok" && result.result?.blocks.length !== input.blocks.length) {
      return { ...result, outcome: "invalid", result: null };
    }
    return result;
  }

  /** Feature 005: classify a guest message without the guide (research R3). */
  async classifyGuestMessage(
    input: GuestClassificationInput,
    options: LlmCallOptions = {},
  ): Promise<AgentCallResult<GuestClassification>> {
    return this.agentCall(
      guestClassificationSchema,
      [{ type: "text", text: CLASSIFY_SYSTEM, cache_control: { type: "ephemeral" } }],
      classifyUserPrompt(input),
      512,
      options,
    );
  }

  /**
   * Feature 005: answer from the published guide (research R3, R4). The rules and the property's
   * knowledge are two cached system blocks, so every message of a conversation reuses the prefix.
   */
  async answerGuest(
    input: AnswerGuestInput,
    options: LlmCallOptions = {},
  ): Promise<AgentCallResult<GuestAnswer>> {
    return this.agentCall(
      guestAnswerSchema,
      [
        { type: "text", text: ANSWER_SYSTEM },
        { type: "text", text: knowledgeBlock(input), cache_control: { type: "ephemeral" } },
      ],
      answerUserPrompt(input),
      2048,
      options,
    );
  }

  private async agentCall<T>(
    schema: z.ZodType<T>,
    system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[],
    user: string,
    maxTokens: number,
    options: LlmCallOptions,
  ): Promise<AgentCallResult<T>> {
    let response;
    try {
      response = await this.client.beta.messages.create(
        {
          model: AGENT_MODEL,
          max_tokens: maxTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system,
          messages: [{ role: "user", content: user }],
          output_config: { effort: AGENT_EFFORT, format: betaZodOutputFormat(schema) },
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
    const usage = agentUsage(response.model, response.usage);
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
