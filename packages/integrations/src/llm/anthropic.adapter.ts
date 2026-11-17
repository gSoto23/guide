import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { buildExtractionMessage, EXTRACTION_SYSTEM_PROMPT } from "./extraction/prompt.js";
import { listingExtractionSchema } from "./extraction/schema.js";
import {
  LlmTimeoutError,
  LlmUnavailableError,
  type ExtractionUsage,
  type LlmExtractionResult,
  type LlmPort,
} from "./port.js";

/** ADR-0005: the default model and the effort for listing extraction (research R6). */
export const EXTRACTION_MODEL = "claude-opus-5-5";
export const EXTRACTION_EFFORT = "low";

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
}
