import {
  AMENITY_KEYS,
  type AmenityKey,
  type PmsListing,
  type PmsListingFacts,
  type PmsReservation,
  type PmsText,
} from "../port.js";
import type { Beds24Booking, Beds24Property, Beds24RoomType } from "./schemas.js";

/**
 * Beds24 `featureCodes` mapped to Guidesk amenity keys (research R7). Codes from the Beds24 wiki's
 * channel mapping pages; a code that is not here is dropped.
 */
export const BEDS24_AMENITIES: Readonly<Record<string, AmenityKey>> = {
  WIFI: "wifi",
  INTERNET: "wifi",
  AIR_CONDITIONING: "air_conditioning",
  HEATING: "heating",
  KITCHEN: "kitchen",
  KITCHENETTE: "kitchen",
  WASHER: "washer",
  DRYER: "dryer",
  PARKING: "free_parking",
  POOL: "pool",
  POOL_HEATED: "pool",
  POOL_PRIVATE: "pool",
  HOT_TUB: "hot_tub",
  TV: "tv",
  IRON_BOARD: "iron",
  HAIR_DRYER: "hair_dryer",
  COFFEE_MAKER: "coffee_maker",
  DISHWASHER: "dishwasher",
  MICROWAVE: "microwave",
  REFRIGERATOR: "refrigerator",
  GRILL: "bbq",
  BALCONY: "balcony",
  GARDEN: "garden",
  ELEVATOR: "elevator",
  GYM: "gym",
  BEACH_FRONT: "beach_access",
  WATER_VIEW: "ocean_view",
  CRIB: "crib",
  PETS_CONSIDERED: "pets_allowed",
  SMOKE_DETECTOR: "smoke_alarm",
  CO_DETECTOR: "carbon_monoxide_alarm",
  FIRST_AID_KIT: "first_aid_kit",
  FIRE_EXTINGUISHER: "fire_extinguisher",
  EV_CHARGER: "ev_charger",
};

/** `HH:MM`, 24-hour, the same rule as the domain's `TIME_OF_DAY`. */
const TIME_OF_DAY = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Beds24 statuses Guidesk keeps; `request`, `inquiry`, `black`, and unknown ones are skipped. */
const RESERVATION_STATUS: Readonly<Record<string, PmsReservation["status"]>> = {
  confirmed: "active",
  new: "active",
  cancelled: "cancelled",
};

/** Display names for the `channel` values Guidesk names itself. */
const CHANNEL_NAMES: Readonly<Record<string, string>> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  vrbo: "Vrbo",
  homeaway: "Vrbo",
  expedia: "Expedia",
  direct: "Direct",
};

export function listingExternalId(propertyId: number, roomTypeId: number): string {
  return `${propertyId}:${roomTypeId}`;
}

export function parseListingExternalId(
  externalId: string,
): { propertyId: number; roomTypeId: number } | null {
  const match = /^(\d+):(\d+)$/.exec(externalId.trim());
  if (!match) return null;
  return { propertyId: Number(match[1]), roomTypeId: Number(match[2]) };
}

/** Known codes become amenity keys, once each, in `AMENITY_KEYS` order so re-imports compare. */
export function mapAmenities(...codeLists: readonly (readonly string[])[]): AmenityKey[] {
  const found = new Set<AmenityKey>();
  for (const code of codeLists.flat()) {
    const key = code.trim().toUpperCase();
    if (Object.hasOwn(BEDS24_AMENITIES, key)) found.add(BEDS24_AMENITIES[key]!);
  }
  return AMENITY_KEYS.filter((key) => found.has(key));
}

/** One listing per room type, because room types are what the channels list (R7). */
export function mapListings(property: Beds24Property): PmsListing[] {
  const roomTypes = property.roomTypes ?? [];
  const propertyName = clean(property.name) ?? `Beds24 ${property.id}`;
  return roomTypes.map((roomType) => ({
    externalId: listingExternalId(property.id, roomType.id),
    name:
      roomTypes.length > 1
        ? `${propertyName} · ${clean(roomType.name) ?? String(roomType.id)}`
        : propertyName,
    facts: listingFacts(property, roomType),
    texts: listingTexts(property, roomType),
    amenities: mapAmenities(property.featureCodes, roomType.featureCodes),
  }));
}

function listingFacts(property: Beds24Property, roomType: Beds24RoomType): PmsListingFacts {
  const country = clean(property.country);
  const maxPeople = roomType.maxPeople;
  return {
    addressLine1: clean(property.address),
    city: clean(property.city),
    region: clean(property.state),
    postalCode: clean(property.postcode),
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    checkInTime: timeOfDay(property.checkInStart),
    checkoutTime: timeOfDay(property.checkOutEnd),
    maxGuests: maxPeople != null && maxPeople >= 1 && maxPeople <= 50 ? maxPeople : null,
  };
}

/**
 * The headline, the property description (followed by the room type's description in the same
 * language), and the house rules, per language. Nothing else is read: templates, info items, unit
 * notes, directions, and custom questions are where hosts and lock integrations put codes.
 */
function listingTexts(property: Beds24Property, roomType: Beds24RoomType): PmsText[] {
  const roomDescriptions = new Map<string | null, string>();
  for (const entry of roomType.texts ?? []) {
    const body = clean(entry.roomDescription);
    const language = languageTag(entry.language);
    if (body && !roomDescriptions.has(language)) roomDescriptions.set(language, body);
  }
  const texts: PmsText[] = [];
  const described = new Set<string | null>();
  for (const entry of property.texts ?? []) {
    const language = languageTag(entry.language);
    const headline = clean(entry.headline);
    if (headline) {
      texts.push({ kind: "title", language, body: headline, sourceField: "beds24:texts.headline" });
    }
    const propertyDescription = clean(entry.propertyDescription);
    const roomDescription = described.has(language) ? undefined : roomDescriptions.get(language);
    if (propertyDescription) {
      texts.push({
        kind: "description",
        language,
        body: roomDescription
          ? `${propertyDescription}\n\n${roomDescription}`
          : propertyDescription,
        sourceField: "beds24:texts.propertyDescription",
      });
      described.add(language);
    } else if (roomDescription) {
      texts.push(roomDescriptionText(language, roomDescription));
      described.add(language);
    }
    const houseRules = clean(entry.houseRules);
    if (houseRules) {
      texts.push({
        kind: "house_rules",
        language,
        body: houseRules,
        sourceField: "beds24:texts.houseRules",
      });
    }
  }
  // Room descriptions in a language the property has no texts in.
  for (const [language, body] of roomDescriptions) {
    if (!described.has(language)) texts.push(roomDescriptionText(language, body));
  }
  return texts;
}

function roomDescriptionText(language: string | null, body: string): PmsText {
  return {
    kind: "description",
    language,
    body,
    sourceField: "beds24:roomTypes.texts.roomDescription",
  };
}

export function reservationStatus(status: string): PmsReservation["status"] | null {
  const key = status.trim().toLowerCase();
  return Object.hasOwn(RESERVATION_STATUS, key) ? RESERVATION_STATUS[key]! : null;
}

/**
 * The channel from the booking's `channel` value. An empty value is a direct booking; a channel
 * Guidesk does not name uses `apiSource` (for example "Hostelworld"), or "Beds24" without one.
 */
export function channelName(
  channel: string | null | undefined,
  apiSource: string | null | undefined,
): string {
  const key = channel?.trim().toLowerCase() ?? "";
  if (key === "") return "Direct";
  if (Object.hasOwn(CHANNEL_NAMES, key)) return CHANNEL_NAMES[key]!;
  return clean(apiSource) ?? "Beds24";
}

/** Null for a status Guidesk skips. The booking's contact fields never reach this point. */
export function mapReservation(booking: Beds24Booking): PmsReservation | null {
  const status = reservationStatus(booking.status);
  if (!status) return null;
  const adults = booking.numAdult;
  const children = booking.numChild;
  const guestName = [clean(booking.firstName), clean(booking.lastName)]
    .filter((part): part is string => part !== null)
    .join(" ");
  return {
    externalUid: String(booking.id),
    listingExternalId: listingExternalId(booking.propertyId, booking.roomId),
    status,
    checkInDate: booking.arrival,
    checkoutDate: booking.departure,
    guestCount: adults == null && children == null ? null : (adults ?? 0) + (children ?? 0),
    guestName: guestName || null,
    bookingReference: String(booking.id),
    channel: channelName(booking.channel, booking.apiSource),
  };
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function timeOfDay(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && TIME_OF_DAY.test(trimmed) ? trimmed : null;
}

/** Beds24 language codes are BCP 47 except `zt`, its code for traditional Chinese. */
function languageTag(value: string | null | undefined): string | null {
  const tag = clean(value)?.toLowerCase() ?? null;
  return tag === "zt" ? "zh-Hant" : tag;
}
