/**
 * The PMS port (feature 002 research R7, T089). Each adapter parses provider responses with an
 * allowlist, so the types below are all that crosses the boundary: they have no field for guest
 * contact data, notes, lock codes, or custom fields (FR-030, AC-SEC-012). Every import and
 * refresh request is a read (AC-SEC-013).
 */
export type PmsProvider = "beds24" | "hostex";

/** Guidesk amenity keys, mapped from each provider's codes; unknown codes are dropped. */
export const AMENITY_KEYS = [
  "wifi",
  "air_conditioning",
  "heating",
  "kitchen",
  "washer",
  "dryer",
  "free_parking",
  "pool",
  "hot_tub",
  "tv",
  "workspace",
  "iron",
  "hair_dryer",
  "coffee_maker",
  "dishwasher",
  "microwave",
  "refrigerator",
  "bbq",
  "balcony",
  "garden",
  "elevator",
  "gym",
  "beach_access",
  "ocean_view",
  "crib",
  "pets_allowed",
  "smoke_alarm",
  "carbon_monoxide_alarm",
  "first_aid_kit",
  "fire_extinguisher",
  "wheelchair_accessible",
  "ev_charger",
] as const;
export type AmenityKey = (typeof AMENITY_KEYS)[number];

/** Which listing-content kind an imported text belongs to. */
export type PmsTextKind = "title" | "description" | "house_rules";

export interface PmsText {
  kind: PmsTextKind;
  /** BCP 47 tag when the provider gives one; content keeps its language (FR-019). */
  language: string | null;
  body: string;
  /** Where it was found, for example `beds24:texts.houseRules`, for re-import matching. */
  sourceField: string;
}

export interface PmsListingFacts {
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  /** ISO 3166-1 alpha-2, or null when the provider's value is not one. */
  country: string | null;
  /** `HH:MM`. */
  checkInTime: string | null;
  checkoutTime: string | null;
  maxGuests: number | null;
}

/** A listing summary, enough to choose what to import. */
export interface PmsListingSummary {
  /** Beds24: `{propertyId}:{roomTypeId}`; Hostex: the property ID. */
  externalId: string;
  name: string;
}

export interface PmsListing extends PmsListingSummary {
  facts: PmsListingFacts;
  texts: PmsText[];
  amenities: AmenityKey[];
}

export interface PmsReservation {
  /** The provider's booking or reservation ID, unique per connection. */
  externalUid: string;
  listingExternalId: string;
  status: "active" | "cancelled";
  /** `YYYY-MM-DD`. */
  checkInDate: string;
  checkoutDate: string;
  guestCount: number | null;
  guestName: string | null;
  bookingReference: string | null;
  /** For example "Airbnb", "Booking.com", or "Direct". */
  channel: string;
}

export interface PmsReservationQuery {
  listingExternalIds: readonly string[];
  /** Reservations whose checkout is on or after this date (`YYYY-MM-DD`). */
  checkoutFrom: string;
  /** And on or before this one. */
  checkoutTo: string;
  /** Only reservations changed since then, every status included (Beds24 refreshes). */
  modifiedSince?: Date;
}

export interface PmsConnected {
  /** What Guidesk stores, encrypted: the Beds24 refresh token, or the Hostex access token. */
  credential: string;
  externalAccountId: string;
  accountLabel: string;
}

export interface PmsCallOptions {
  signal?: AbortSignal;
}

export interface PmsPort {
  readonly provider: PmsProvider;
  /**
   * Checks the host's value with the provider. Beds24 exchanges the invite code, once, for a
   * refresh token. Throws `PmsCredentialError` when the provider refuses it.
   */
  validateCredential(input: string, options?: PmsCallOptions): Promise<PmsConnected>;
  listListings(credential: string, options?: PmsCallOptions): Promise<PmsListing[]>;
  getListing(
    credential: string,
    externalId: string,
    options?: PmsCallOptions,
  ): Promise<PmsListing | null>;
  listReservations(
    credential: string,
    query: PmsReservationQuery,
    options?: PmsCallOptions,
  ): Promise<PmsReservation[]>;
  /** Revokes the token at the provider where it can (Beds24); Hostex has no endpoint for it. */
  revoke(credential: string, options?: PmsCallOptions): Promise<{ providerRevoked: boolean }>;
}

/** The provider refused the credential: invalid, expired, or revoked by the host. */
export class PmsCredentialError extends Error {
  constructor(readonly provider: PmsProvider) {
    super(`${provider} refused the credential`);
    this.name = "PmsCredentialError";
  }
}

/** The provider failed or answered something the adapter could not read. No response body. */
export class PmsProviderError extends Error {
  constructor(
    readonly provider: PmsProvider,
    readonly code: "provider_error" | "rate_limited" | "timeout" = "provider_error",
  ) {
    super(`${provider}: ${code}`);
    this.name = "PmsProviderError";
  }
}

/** Where the host deletes a token Guidesk could not revoke (FR-036). */
export const PMS_TOKEN_INSTRUCTIONS: Record<PmsProvider, string> = {
  beds24: "https://wiki.beds24.com/index.php/Category:API_V2",
  hostex: "https://hostex.io/settings/open_api",
};

/** Where the host gets a credential, shown with `invalid_credential` (contracts). */
export const PMS_HELP_URLS: Record<PmsProvider, string> = {
  beds24: "https://wiki.beds24.com/index.php/Category:API_V2",
  hostex: "https://hostex.io/settings/open_api",
};
