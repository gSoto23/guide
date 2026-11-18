import {
  ExperiencePartnerError,
  type ExperiencePartnerPort,
  type ExperienceSearch,
  type PartnerDestination,
  type PartnerExperience,
  type PartnerTag,
} from "./port.js";

/**
 * Viator Partner API v2 with basic affiliate access (feature 009 research R1, R2): product search by
 * destination, destinations, and tags. The key travels only in the `exp-api-key` header; errors carry
 * a code, never the response body. Every response field is checked: anything unexpected is dropped.
 */
export interface ViatorAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const VIATOR_HOSTS = new Set(["viator.com", "www.viator.com"]);
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE_TARGET_WIDTH = 480;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function httpsOn(value: unknown, hosts?: Set<string>): string | null {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (hosts && !hosts.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function duration(value: unknown): number | null {
  if (!isObject(value)) return null;
  const minutes =
    finite(value.fixedDurationInMinutes) ??
    finite(value.variableDurationFromMinutes) ??
    finite(value.unstructuredDurationInMinutes);
  return minutes !== null && minutes >= 1 && minutes <= 20160 ? Math.round(minutes) : null;
}

/** The cover image's variant closest to 480 px wide, at least 240 px. */
function image(value: unknown): PartnerExperience["image"] {
  if (!Array.isArray(value)) return null;
  const cover = value.find((item) => isObject(item) && item.isCover === true) ?? value[0];
  if (!isObject(cover) || !Array.isArray(cover.variants)) return null;
  let best: { url: string; width: number; height: number } | null = null;
  for (const variant of cover.variants) {
    if (!isObject(variant)) continue;
    const url = httpsOn(variant.url);
    const width = finite(variant.width);
    const height = finite(variant.height);
    if (!url || !width || !height || width < 240) continue;
    if (!best || Math.abs(width - IMAGE_TARGET_WIDTH) < Math.abs(best.width - IMAGE_TARGET_WIDTH)) {
      best = { url, width: Math.round(width), height: Math.round(height) };
    }
  }
  return best;
}

/** Drops trailing slashes with a loop (no backtracking regex on configuration text). */
function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

export function parseViatorProduct(value: unknown): PartnerExperience | null {
  if (!isObject(value)) return null;
  const productId = typeof value.productCode === "string" ? value.productCode : "";
  const title = text(value.title, 200);
  const partnerUrl = httpsOn(value.productUrl, VIATOR_HOSTS);
  if (!PRODUCT_ID.test(productId) || !title || !partnerUrl) return null;
  const pricing = isObject(value.pricing) ? value.pricing : {};
  const summary = isObject(pricing.summary) ? pricing.summary : {};
  const fromPrice = finite(summary.fromPrice);
  const currency =
    typeof pricing.currency === "string" && /^[A-Z]{3}$/.test(pricing.currency)
      ? pricing.currency
      : null;
  const reviews = isObject(value.reviews) ? value.reviews : {};
  const rating = finite(reviews.combinedAverageRating);
  const reviewCount = finite(reviews.totalReviews);
  const translation = isObject(value.translationInfo) ? value.translationInfo : {};
  return {
    productId,
    title,
    description: text(value.description, 2000) ?? "",
    durationMinutes: duration(value.duration),
    priceFrom: fromPrice !== null && fromPrice >= 0 && currency ? fromPrice : null,
    currency: fromPrice !== null && fromPrice >= 0 ? currency : null,
    rating: rating !== null && rating >= 0 && rating <= 5 ? Math.round(rating * 100) / 100 : null,
    reviewCount: reviewCount !== null && reviewCount >= 0 ? Math.round(reviewCount) : null,
    image: image(value.images),
    partnerUrl,
    tagIds: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is number => Number.isInteger(tag))
      : [],
    machineTranslated: translation.containsMachineTranslatedText === true,
  };
}

export class ViatorAdapter implements ExperiencePartnerPort {
  readonly partner = "viator" as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ViatorAdapterOptions) {
    this.baseUrl = withoutTrailingSlashes(options.baseUrl ?? "https://api.viator.com/partner");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    language: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Json> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "exp-api-key": this.options.apiKey,
          accept: "application/json;version=2.0",
          "accept-language": language,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      throw new ExperiencePartnerError("timeout");
    }
    if (response.status === 429) throw new ExperiencePartnerError("http_429");
    if (response.status >= 500) throw new ExperiencePartnerError("http_5xx");
    if (!response.ok) throw new ExperiencePartnerError("http_4xx");
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ExperiencePartnerError("invalid");
    }
    if (!isObject(json)) throw new ExperiencePartnerError("invalid");
    return json;
  }

  async search(
    input: ExperienceSearch,
    options: { signal?: AbortSignal } = {},
  ): Promise<PartnerExperience[]> {
    const json = await this.request(
      "POST",
      "/products/search",
      input.language === "es" ? "es" : "en-US",
      {
        filtering: { destination: input.destinationId },
        sorting: { sort: "DEFAULT" },
        pagination: { start: 1, count: Math.min(Math.max(input.count, 1), 50) },
        currency: input.currency,
      },
      options.signal,
    );
    if (!Array.isArray(json.products)) throw new ExperiencePartnerError("invalid");
    return json.products
      .map(parseViatorProduct)
      .filter((item): item is PartnerExperience => item !== null);
  }

  async destinations(options: { signal?: AbortSignal } = {}): Promise<PartnerDestination[]> {
    const json = await this.request("GET", "/destinations", "en-US", null, options.signal);
    if (!Array.isArray(json.destinations)) throw new ExperiencePartnerError("invalid");
    const out: PartnerDestination[] = [];
    for (const item of json.destinations) {
      if (!isObject(item)) continue;
      const id = finite(item.destinationId);
      const name = text(item.name, 120);
      const lookupId = typeof item.lookupId === "string" ? item.lookupId : null;
      if (id === null || !name || !lookupId || !/^[0-9.]{1,100}$/.test(lookupId)) continue;
      const parent = finite(item.parentDestinationId);
      out.push({
        id: String(id),
        name,
        type: typeof item.type === "string" ? item.type.slice(0, 40) : "UNKNOWN",
        parentId: parent === null ? null : String(parent),
        lookupId,
      });
    }
    return out;
  }

  async tags(options: { signal?: AbortSignal } = {}): Promise<PartnerTag[]> {
    const json = await this.request("GET", "/products/tags", "en-US", null, options.signal);
    if (!Array.isArray(json.tags)) throw new ExperiencePartnerError("invalid");
    const out: PartnerTag[] = [];
    for (const item of json.tags) {
      if (!isObject(item) || !Number.isInteger(item.tagId)) continue;
      const names = isObject(item.allNamesByLocale) ? item.allNamesByLocale : {};
      const name = text(names.en, 120) ?? text(item.tagName, 120);
      if (!name) continue;
      out.push({
        id: item.tagId as number,
        parentIds: Array.isArray(item.parentTagIds)
          ? item.parentTagIds.filter((tag): tag is number => Number.isInteger(tag))
          : [],
        name,
      });
    }
    return out;
  }
}
