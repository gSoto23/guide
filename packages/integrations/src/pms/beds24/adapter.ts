import { setTimeout as delay } from "node:timers/promises";
import {
  PmsCredentialError,
  type PmsCallOptions,
  type PmsConnected,
  type PmsListing,
  type PmsPort,
  type PmsReservation,
  type PmsReservationQuery,
} from "../port.js";
import { BEDS24_BASE_URL, Beds24Client } from "./client.js";
import {
  listingExternalId,
  mapListings,
  mapReservation,
  parseListingExternalId,
} from "./mapping.js";
import { beds24BookingsPageSchema, beds24PropertiesPageSchema } from "./schemas.js";

export interface Beds24AdapterOptions {
  /** Injectable for the fixture server and contract tests. */
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Waits at the credit floor and after a 429; tests inject one that records the wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Every status, so a refresh sees cancellations (Beds24 leaves `cancelled` out by default). */
const BOOKING_STATUSES = ["confirmed", "new", "cancelled", "request", "inquiry", "black"] as const;

/** Invite codes are printable ASCII; anything else cannot be a code and cannot go in a header. */
const INVITE_CODE = /^[\x21-\x7e]+$/;

/**
 * The Beds24 adapter (research R7, T090): read-only access to properties and bookings through
 * API V2. Guidesk stores only the refresh token; the invite code is used once and dropped.
 * Responses are parsed with allowlist schemas, so contact data never leaves this module.
 */
export class Beds24Adapter implements PmsPort {
  readonly provider = "beds24" as const;
  private readonly client: Beds24Client;

  constructor(options: Beds24AdapterOptions = {}) {
    this.client = new Beds24Client({
      fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      baseUrl: options.baseUrl ?? BEDS24_BASE_URL,
      sleep: options.sleep ?? ((ms) => delay(ms)),
      now: options.now ?? Date.now,
    });
  }

  /** Exchanges the invite code for a refresh token and reads the account ID with it. */
  async validateCredential(input: string, options: PmsCallOptions = {}): Promise<PmsConnected> {
    const inviteCode = input.trim();
    if (!INVITE_CODE.test(inviteCode)) throw new PmsCredentialError("beds24");
    const { refreshToken, accessToken } = await this.client.setup(inviteCode, options.signal);
    const ownerId = await this.client.ownerId(refreshToken, accessToken, options.signal);
    return {
      credential: refreshToken,
      externalAccountId: ownerId,
      accountLabel: `Beds24 ${ownerId}`,
    };
  }

  /** One listing per room type of every property, with texts and all room types included. */
  async listListings(credential: string, options: PmsCallOptions = {}): Promise<PmsListing[]> {
    const properties = await this.client.getAll(
      credential,
      "/properties",
      { includeTexts: "all", includeAllRooms: true },
      beds24PropertiesPageSchema,
      options.signal,
    );
    return properties.flatMap(mapListings);
  }

  async getListing(
    credential: string,
    externalId: string,
    options: PmsCallOptions = {},
  ): Promise<PmsListing | null> {
    const ids = parseListingExternalId(externalId);
    if (!ids) return null;
    const body = await this.client.get(
      credential,
      "/properties",
      { id: ids.propertyId, includeTexts: "all", includeAllRooms: true },
      beds24PropertiesPageSchema,
      options.signal,
    );
    const property = body.data.find((candidate) => candidate.id === ids.propertyId);
    if (!property) return null;
    const wanted = listingExternalId(ids.propertyId, ids.roomTypeId);
    return mapListings(property).find((listing) => listing.externalId === wanted) ?? null;
  }

  /**
   * One paged `GET /bookings` for every property of the requested listings, with every status
   * and the checkout window; a refresh adds `modifiedFrom` (UTC). Bookings of room types that
   * were not requested, and skipped statuses, are left out.
   */
  async listReservations(
    credential: string,
    query: PmsReservationQuery,
    options: PmsCallOptions = {},
  ): Promise<PmsReservation[]> {
    const wanted = new Set<string>();
    const propertyIds = new Set<number>();
    for (const externalId of query.listingExternalIds) {
      const ids = parseListingExternalId(externalId);
      if (!ids) continue;
      wanted.add(listingExternalId(ids.propertyId, ids.roomTypeId));
      propertyIds.add(ids.propertyId);
    }
    if (propertyIds.size === 0) return [];
    const bookings = await this.client.getAll(
      credential,
      "/bookings",
      {
        propertyId: [...propertyIds],
        departureFrom: query.checkoutFrom,
        departureTo: query.checkoutTo,
        status: BOOKING_STATUSES,
        modifiedFrom: query.modifiedSince?.toISOString().slice(0, 19),
      },
      beds24BookingsPageSchema,
      options.signal,
    );
    // Keyed by booking ID, in case a booking moves between pages while they are read.
    const reservations = new Map<string, PmsReservation>();
    for (const booking of bookings) {
      if (!wanted.has(listingExternalId(booking.propertyId, booking.roomId))) continue;
      const reservation = mapReservation(booking);
      if (reservation) reservations.set(reservation.externalUid, reservation);
    }
    return [...reservations.values()];
  }

  /** Revokes the refresh token at Beds24; a failure is reported, never thrown (FR-036). */
  async revoke(
    credential: string,
    options: PmsCallOptions = {},
  ): Promise<{ providerRevoked: boolean }> {
    return { providerRevoked: await this.client.revoke(credential, options.signal) };
  }
}
