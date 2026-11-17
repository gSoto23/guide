import { createHash } from "node:crypto";
import type { z } from "zod";
import { PmsCredentialError, PmsProviderError } from "../port.js";
import { beds24DetailsSchema, beds24SetupSchema, beds24TokenSchema } from "./schemas.js";

export const BEDS24_BASE_URL = "https://beds24.com/api/v2";

/**
 * Credits left for the host's other tools: Beds24 allows 100 per 5 minutes per account, shared
 * by everything the host connects (R7), so the adapter waits for the reset instead of going below.
 */
export const BEDS24_CREDIT_FLOOR = 30;

/** Access tokens are reused until 5 minutes before they expire. */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
/** The wait when Beds24 says nothing about the reset. */
const UNKNOWN_RESET_WAIT_MS = 60_000;
/** Retries after a 429, so three attempts in all. */
const RATE_LIMIT_RETRIES = 2;
/** A guard against a provider that always says another page exists. */
const MAX_PAGES = 1_000;
/** Shown to the host next to the token in Beds24's API settings. */
const DEVICE_NAME = "Guidesk";
/** Statuses that mean the invite code or refresh token was refused. */
const REFUSED = new Set([400, 401, 403]);

export type Beds24Query = Record<
  string,
  string | number | boolean | readonly (string | number)[] | undefined
>;

export interface Beds24ClientOptions {
  fetch: typeof fetch;
  baseUrl: string;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface Credits {
  remaining: number | undefined;
  resetsAt: number | undefined;
}

interface SendInit {
  method: "GET" | "DELETE";
  path: string;
  query?: Beds24Query;
  headers: Record<string, string>;
  /** The account whose credits the request spends; null before a refresh token exists. */
  account: string | null;
  /** Whether to wait at the credit floor first; only revoke skips it. */
  throttle: boolean;
}

interface Page<T> {
  pages?: { nextPageExists: boolean } | null;
  data: T[];
}

/**
 * The Beds24 API V2 client (research R7, T090): the invite-code exchange, the access-token cache,
 * and the credit-aware throttle, over an injected `fetch`.
 *
 * Access tokens and credit counts live in memory only, keyed by a SHA-256 of the refresh token so
 * the token itself is never a map key; nothing here is logged. Errors never carry a response
 * body. Every call but revoke is a GET (AC-SEC-013).
 */
export class Beds24Client {
  private readonly accessTokens = new Map<string, CachedToken>();
  private readonly credits = new Map<string, Credits>();

  constructor(private readonly options: Beds24ClientOptions) {}

  /**
   * Exchanges the invite code, once, for a refresh token. The access token that comes with it is
   * cached, so the import right after connecting needs no token request.
   */
  async setup(
    inviteCode: string,
    signal?: AbortSignal,
  ): Promise<{ refreshToken: string; accessToken: string }> {
    const response = await this.send(
      {
        method: "GET",
        path: "/authentication/setup",
        headers: { code: inviteCode, deviceName: DEVICE_NAME },
        account: null,
        throttle: false,
      },
      signal,
    );
    if (REFUSED.has(response.status)) {
      await discard(response);
      throw new PmsCredentialError("beds24");
    }
    const body = await readBody(response, beds24SetupSchema, signal);
    const account = accountKey(body.refreshToken);
    const credits = readCredits(response.headers, this.options.now());
    if (credits) this.credits.set(account, credits);
    this.cacheToken(account, body.token, body.expiresIn);
    return { refreshToken: body.refreshToken, accessToken: body.token };
  }

  /** The account ID (`token.ownerId`); Beds24 has no account name. */
  async ownerId(refreshToken: string, accessToken: string, signal?: AbortSignal): Promise<string> {
    const response = await this.send(
      {
        method: "GET",
        path: "/authentication/details",
        headers: { token: accessToken },
        account: accountKey(refreshToken),
        throttle: true,
      },
      signal,
    );
    if (response.status === 401 || response.status === 403) {
      await discard(response);
      throw new PmsCredentialError("beds24");
    }
    const body = await readBody(response, beds24DetailsSchema, signal);
    if (body.validToken === false) throw new PmsCredentialError("beds24");
    if (!body.token) throw new PmsProviderError("beds24");
    return String(body.token.ownerId);
  }

  /**
   * An authenticated GET. When Beds24 refuses a cached access token (it can drop tokens early),
   * the cache entry goes and the call is tried once more with a fresh token.
   */
  async get<T>(
    refreshToken: string,
    path: string,
    query: Beds24Query,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const account = accountKey(refreshToken);
    let retried = false;
    for (;;) {
      const { token, cached } = await this.accessToken(refreshToken, account, signal);
      const response = await this.send(
        { method: "GET", path, query, headers: { token }, account, throttle: true },
        signal,
      );
      if (response.status === 401 && cached && !retried) {
        await discard(response);
        this.accessTokens.delete(account);
        retried = true;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        await discard(response);
        this.accessTokens.delete(account);
        throw new PmsCredentialError("beds24");
      }
      return readBody(response, schema, signal);
    }
  }

  /** Every page of a list endpoint (`page=1, 2, …` while `pages.nextPageExists`). */
  async getAll<T>(
    refreshToken: string,
    path: string,
    query: Beds24Query,
    schema: z.ZodType<Page<T>>,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await this.get(refreshToken, path, { ...query, page }, schema, signal);
      items.push(...body.data);
      if (!body.pages?.nextPageExists) return items;
    }
    throw new PmsProviderError("beds24");
  }

  /**
   * `DELETE /authentication/token`. True when Beds24 confirms; false for any failure, which the
   * caller reports to the host instead of throwing (FR-036). Skips the credit floor: one request
   * to end access is worth more than the margin. The cached access token goes either way.
   */
  async revoke(refreshToken: string, signal?: AbortSignal): Promise<boolean> {
    const account = accountKey(refreshToken);
    this.accessTokens.delete(account);
    try {
      const response = await this.send(
        {
          method: "DELETE",
          path: "/authentication/token",
          headers: { refreshToken },
          account,
          throttle: false,
        },
        signal,
      );
      await discard(response);
      return response.ok;
    } catch {
      return false;
    } finally {
      this.accessTokens.delete(account);
      this.credits.delete(account);
    }
  }

  private async accessToken(
    refreshToken: string,
    account: string,
    signal?: AbortSignal,
  ): Promise<{ token: string; cached: boolean }> {
    const cached = this.accessTokens.get(account);
    if (cached && this.options.now() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return { token: cached.token, cached: true };
    }
    this.accessTokens.delete(account);
    const response = await this.send(
      {
        method: "GET",
        path: "/authentication/token",
        headers: { refreshToken },
        account,
        throttle: true,
      },
      signal,
    );
    if (REFUSED.has(response.status)) {
      await discard(response);
      throw new PmsCredentialError("beds24");
    }
    const body = await readBody(response, beds24TokenSchema, signal);
    this.cacheToken(account, body.token, body.expiresIn);
    return { token: body.token, cached: false };
  }

  private cacheToken(account: string, token: string, expiresInSeconds: number): void {
    this.accessTokens.set(account, {
      token,
      expiresAt: this.options.now() + expiresInSeconds * 1000,
    });
  }

  /**
   * One request: waits at the credit floor first, records the credit headers of every answer, and
   * after a 429 waits for the reset and tries again, up to twice.
   */
  private async send(init: SendInit, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      if (init.account !== null && init.throttle) await this.throttle(init.account, signal);
      let response: Response;
      try {
        response = await this.options.fetch(this.url(init.path, init.query), {
          method: init.method,
          headers: init.headers,
          signal,
        });
      } catch {
        throw new PmsProviderError("beds24", signal?.aborted ? "timeout" : "provider_error");
      }
      const credits = readCredits(response.headers, this.options.now());
      if (init.account !== null && credits) this.credits.set(init.account, credits);
      if (response.status !== 429) return response;
      await discard(response);
      if (attempt >= RATE_LIMIT_RETRIES) throw new PmsProviderError("beds24", "rate_limited");
      await this.wait(this.rateLimitWait(init.account, credits), signal);
      if (init.account !== null) this.credits.delete(init.account);
    }
  }

  /**
   * Never spends below the floor: with `BEDS24_CREDIT_FLOOR` or fewer credits known to remain,
   * waits until the window resets. A reset time already past means the window is new.
   */
  private async throttle(account: string, signal?: AbortSignal): Promise<void> {
    const state = this.credits.get(account);
    if (state?.remaining === undefined || state.remaining > BEDS24_CREDIT_FLOOR) return;
    const waitMs =
      state.resetsAt === undefined ? UNKNOWN_RESET_WAIT_MS : state.resetsAt - this.options.now();
    if (waitMs > 0) await this.wait(waitMs, signal);
    this.credits.delete(account);
  }

  /** The 429's own reset time, else the last one known for the account, else 60 s. */
  private rateLimitWait(account: string | null, latest: Credits | null): number {
    const now = this.options.now();
    if (latest?.resetsAt !== undefined) return Math.max(0, latest.resetsAt - now);
    const known = account === null ? undefined : this.credits.get(account)?.resetsAt;
    return known !== undefined && known > now ? known - now : UNKNOWN_RESET_WAIT_MS;
  }

  /** The injected sleep, cut short when the caller's signal aborts. */
  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new PmsProviderError("beds24", "timeout"));
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new PmsProviderError("beds24", "timeout"));
      signal?.addEventListener("abort", onAbort, { once: true });
      this.options.sleep(ms).then(
        () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        (error: unknown) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error instanceof Error ? error : new PmsProviderError("beds24"));
        },
      );
    });
  }

  private url(path: string, query: Beds24Query = {}): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, String(item));
      } else {
        params.append(key, String(value));
      }
    }
    const search = params.toString();
    return `${this.options.baseUrl.replace(/\/+$/, "")}${path}${search ? `?${search}` : ""}`;
  }
}

/** The cache key for an account: never the refresh token itself. */
function accountKey(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}

/**
 * The credit headers, in both spellings: `X-FiveMinCreditLimit-*` (the OpenAPI spec) and
 * `x-five-min-limit-*` (the wiki). `Headers.get` is case-insensitive.
 */
function readCredits(headers: Headers, now: number): Credits | null {
  const remaining = intHeader(
    headers,
    "x-fivemincreditlimit-remaining",
    "x-five-min-limit-remaining",
  );
  const resetsIn = intHeader(
    headers,
    "x-fivemincreditlimit-resetsin",
    "x-five-min-limit-resets-in",
  );
  if (remaining === undefined && resetsIn === undefined) return null;
  return { remaining, resetsAt: resetsIn === undefined ? undefined : now + resetsIn * 1000 };
}

function intHeader(headers: Headers, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = headers.get(name)?.trim();
    if (value && /^-?\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

/** Parses a 2xx JSON body with an allowlist schema; anything else is a provider error. */
async function readBody<T>(
  response: Response,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!response.ok) {
    await discard(response);
    throw new PmsProviderError("beds24");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PmsProviderError("beds24", signal?.aborted ? "timeout" : "provider_error");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new PmsProviderError("beds24");
  return parsed.data;
}

/** Releases a body that is not read, so the connection can be reused. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing to release.
  }
}
