import type { z } from "zod";
import { PmsCredentialError, PmsProviderError, type PmsCallOptions } from "../port.js";
import { envelopeSchema } from "./schemas.js";

export const HOSTEX_BASE_URL = "https://api.hostex.io/v3";

/** The largest page Hostex serves for properties and reservations. */
export const HOSTEX_PAGE_SIZE = 100;

/** Retries after a 429 before giving up, so three attempts in all. */
const RATE_LIMIT_RETRIES = 2;
const DEFAULT_RETRY_AFTER_SECONDS = 60;

/**
 * A longer `Retry-After` means an hourly or daily quota is spent. Waiting that long inside a
 * request or job would block it, so the caller gets `rate_limited` and retries later.
 */
const MAX_RETRY_AFTER_SECONDS = 120;

/** Hostex asks integrations for a meaningful User-Agent (rate-limit docs). */
const USER_AGENT = "Guidesk/1.0";

/** Visible ASCII only: anything else cannot be a token and must not reach a header. */
const TOKEN_PATTERN = /^[\x21-\x7e]{1,512}$/;

export type HostexQuery = Record<string, string | number | undefined>;

export interface HostexClientOptions {
  fetch: typeof fetch;
  baseUrl: string;
  sleep: (ms: number) => Promise<void>;
}

interface Envelope {
  errorCode: number;
  data: unknown;
  retryAfterSeconds: number;
}

/**
 * Read-only HTTP client for Hostex Open API v3 (research R7, T091). Every request is a GET with
 * the `Hostex-Access-Token` header. HTTP is 200 even for errors, so the envelope's `error_code`
 * decides: 401 and 420 (Basic edition or expired subscription) refuse the credential, 429 waits
 * for `Retry-After` and retries twice, anything else is a provider error. Errors never carry
 * Hostex's `error_msg` or the body.
 */
export class HostexClient {
  private readonly baseUrl: string;

  constructor(private readonly options: HostexClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  /** GETs `path` and returns its `data`, read with `schema`. */
  async get<T>(
    token: string,
    path: string,
    query: HostexQuery,
    schema: z.ZodType<T>,
    call: PmsCallOptions = {},
  ): Promise<T> {
    if (!TOKEN_PATTERN.test(token)) throw new PmsCredentialError("hostex");
    const url = this.url(path, query);
    for (let attempt = 0; ; attempt++) {
      const envelope = await this.request(token, url, call);
      if (envelope.errorCode === 200) {
        const parsed = schema.safeParse(envelope.data);
        if (!parsed.success) throw new PmsProviderError("hostex");
        return parsed.data;
      }
      if (envelope.errorCode === 401 || envelope.errorCode === 420) {
        throw new PmsCredentialError("hostex");
      }
      if (envelope.errorCode !== 429) throw new PmsProviderError("hostex");
      if (attempt >= RATE_LIMIT_RETRIES || envelope.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS) {
        throw new PmsProviderError("hostex", "rate_limited");
      }
      await this.options.sleep(envelope.retryAfterSeconds * 1000);
      if (call.signal?.aborted) throw new PmsProviderError("hostex", "timeout");
    }
  }

  private url(path: string, query: HostexQuery): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const search = params.toString();
    return `${this.baseUrl}${path}${search ? `?${search}` : ""}`;
  }

  private async request(token: string, url: string, call: PmsCallOptions): Promise<Envelope> {
    const failure = () =>
      new PmsProviderError("hostex", call.signal?.aborted ? "timeout" : "provider_error");
    let response: Response;
    try {
      response = await this.options.fetch(url, {
        method: "GET",
        headers: {
          "Hostex-Access-Token": token,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: call.signal,
      });
    } catch {
      throw failure();
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new PmsProviderError("hostex");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw failure();
    }
    const envelope = envelopeSchema.safeParse(body);
    if (!envelope.success) throw new PmsProviderError("hostex");
    return {
      errorCode: envelope.data.error_code,
      data: envelope.data.data,
      retryAfterSeconds: retryAfterSeconds(response.headers.get("retry-after")),
    };
  }
}

/** `Retry-After` in seconds; Hostex documents seconds, and a missing value means 60. */
function retryAfterSeconds(header: string | null): number {
  if (header === null || header.trim() === "") return DEFAULT_RETRY_AFTER_SECONDS;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.ceil(seconds)
    : DEFAULT_RETRY_AFTER_SECONDS;
}
