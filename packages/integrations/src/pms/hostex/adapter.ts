import type { z } from "zod";
import {
  PmsCredentialError,
  PmsProviderError,
  type PmsCallOptions,
  type PmsConnected,
  type PmsListing,
  type PmsPort,
  type PmsReservation,
  type PmsReservationQuery,
} from "../port.js";
import { HOSTEX_BASE_URL, HOSTEX_PAGE_SIZE, HostexClient } from "./client.js";
import { airbnbListingId, mapProperty, mapReservation } from "./mapping.js";
import {
  accountSchema,
  airbnbRulesSchema,
  propertiesPageSchema,
  propertySchema,
  reservationSchema,
  reservationsPageSchema,
  type HostexAirbnbRules,
  type HostexProperty,
} from "./schemas.js";

export interface HostexAdapterOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  /** Accepted for symmetry with the other adapters; Hostex keeps no time-based state. */
  now?: () => number;
}

/**
 * `price_and_rules` reads Airbnb live and allows 120 requests a minute, so listings fetch it a
 * few at a time.
 */
const RULES_CONCURRENCY = 4;

/**
 * A guard against an API that ignores `offset`: 200 pages are 20,000 properties, or 20,000
 * reservations for one property in the window, far beyond any host Guidesk serves.
 */
const MAX_PAGES = 200;

/** Property IDs are integers; anything else (a Beds24 ID, say) cannot be a Hostex property. */
const PROPERTY_ID = /^\d+$/;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The Hostex adapter (research R7, T091). Read-only: every request is a GET. The stored
 * credential is the host's access token itself, which never expires and which Hostex cannot
 * revoke through the API, so `revoke` makes no request and the host deletes it in Hostex.
 */
export class HostexAdapter implements PmsPort {
  readonly provider = "hostex" as const;
  private readonly client: HostexClient;

  constructor(options: HostexAdapterOptions = {}) {
    this.client = new HostexClient({
      // Resolved per call, so `globalThis.fetch` is never invoked with a foreign `this`.
      fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      baseUrl: options.baseUrl ?? HOSTEX_BASE_URL,
      sleep: options.sleep ?? realSleep,
    });
  }

  /** Checks the token with `GET /accounts/me`, the only identity Hostex gives (no name). */
  async validateCredential(input: string, options: PmsCallOptions = {}): Promise<PmsConnected> {
    const token = input.trim();
    if (!token) throw new PmsCredentialError("hostex");
    const account = await this.client.get(token, "/accounts/me", {}, accountSchema, options);
    return {
      credential: token,
      externalAccountId: account.account_id,
      accountLabel: `Hostex ${account.account_id}`,
    };
  }

  async listListings(credential: string, options: PmsCallOptions = {}): Promise<PmsListing[]> {
    const properties: HostexProperty[] = [];
    for (let offset = 0, pages = 0; ;) {
      if (++pages > MAX_PAGES) throw new PmsProviderError("hostex");
      const page = await this.client.get(
        credential,
        "/properties",
        { offset, limit: HOSTEX_PAGE_SIZE },
        propertiesPageSchema,
        options,
      );
      properties.push(...readItems(page.properties, propertySchema));
      offset += page.properties.length;
      if (page.properties.length === 0 || offset >= page.total) break;
    }
    return mapLimited(properties, RULES_CONCURRENCY, (property) =>
      this.withRules(credential, property, options),
    );
  }

  async getListing(
    credential: string,
    externalId: string,
    options: PmsCallOptions = {},
  ): Promise<PmsListing | null> {
    if (!PROPERTY_ID.test(externalId)) return null;
    const page = await this.client.get(
      credential,
      "/properties",
      { id: externalId },
      propertiesPageSchema,
      options,
    );
    const property = readItems(page.properties, propertySchema).find(
      (item) => item.id === externalId,
    );
    return property ? this.withRules(credential, property, options) : null;
  }

  /**
   * Reservations by checkout date, per property. Hostex has no "changed since" filter, so
   * `modifiedSince` is ignored and the caller's window is read in full every time.
   */
  async listReservations(
    credential: string,
    query: PmsReservationQuery,
    options: PmsCallOptions = {},
  ): Promise<PmsReservation[]> {
    const stays = new Map<string, PmsReservation>();
    for (const propertyId of new Set(query.listingExternalIds)) {
      if (!PROPERTY_ID.test(propertyId)) continue;
      for (let offset = 0, pages = 0; ;) {
        if (++pages > MAX_PAGES) throw new PmsProviderError("hostex");
        const page = await this.client.get(
          credential,
          "/reservations",
          {
            property_id: propertyId,
            start_check_out_date: query.checkoutFrom,
            end_check_out_date: query.checkoutTo,
            offset,
            limit: HOSTEX_PAGE_SIZE,
          },
          reservationsPageSchema,
          options,
        );
        for (const reservation of readItems(page.reservations, reservationSchema)) {
          // The filter is the API's; the check keeps an ignored filter from leaking other stays.
          if (reservation.property_id !== propertyId) continue;
          const stay = mapReservation(reservation);
          // Offset pages can shift when a booking arrives mid-read; the first copy wins.
          if (stay && !stays.has(stay.externalUid)) stays.set(stay.externalUid, stay);
        }
        offset += page.reservations.length;
        if (page.reservations.length < HOSTEX_PAGE_SIZE) break;
      }
    }
    return [...stays.values()];
  }

  /** Host-created tokens have no revoke endpoint (`/oauth/revoke` is for OAuth apps only). */
  async revoke(
    _credential: string,
    _options?: PmsCallOptions,
  ): Promise<{ providerRevoked: boolean }> {
    return { providerRevoked: false };
  }

  private async withRules(
    credential: string,
    property: HostexProperty,
    options: PmsCallOptions,
  ): Promise<PmsListing> {
    const listingId = airbnbListingId(property);
    const rules = listingId ? await this.airbnbRules(credential, listingId, options) : null;
    return mapProperty(property, rules);
  }

  /**
   * Check-in and checkout hours from Airbnb, through Hostex. A failure (a disconnected Airbnb
   * listing, a channel error, the endpoint's rate limit) only leaves the times empty; a refused
   * credential or a cancelled call still stops the whole read.
   */
  private async airbnbRules(
    credential: string,
    listingId: string,
    options: PmsCallOptions,
  ): Promise<HostexAirbnbRules | null> {
    try {
      return await this.client.get(
        credential,
        "/listings/airbnb/price_and_rules",
        { listing_id: listingId },
        airbnbRulesSchema,
        options,
      );
    } catch (error: unknown) {
      if (error instanceof PmsProviderError && error.code !== "timeout") return null;
      throw error;
    }
  }
}

/** Parses each item on its own and drops the ones that cannot be read. */
function readItems<T>(items: readonly unknown[], schema: z.ZodType<T>): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** `Promise.all` over `items` with at most `limit` in flight; stops starting work after a failure. */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]!);
      } catch (error: unknown) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
