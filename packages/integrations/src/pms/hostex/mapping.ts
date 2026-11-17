import type { PmsListing, PmsReservation } from "../port.js";
import type { HostexAirbnbRules, HostexProperty, HostexReservation } from "./schemas.js";

/**
 * Pure mapping from parsed Hostex objects to the port's types (research R7). Hostex gives no
 * city, region, postcode, country, capacity, texts, or amenities, so those stay empty and the
 * property arrives in `needs_details`.
 */

/** `accepted` is a stay; cancelled, denied, and timed-out ones free the dates. */
const STATUS: Record<string, PmsReservation["status"]> = {
  accepted: "active",
  cancelled: "cancelled",
  denied: "cancelled",
  timeout: "cancelled",
};

/** Hostex channel types with a well-known display name. */
const CHANNEL_NAMES: Record<string, string> = {
  airbnb: "Airbnb",
  "booking.com": "Booking.com",
  booking: "Booking.com",
  vrbo: "Vrbo",
  homeaway: "Vrbo",
  expedia: "Expedia",
  agoda: "Agoda",
};

/**
 * Bookings made through Hostex itself. `booking_site` is the host's Hostex direct-booking site
 * (the API docs call it "booking-site (direct booking)"), not Booking.com, which is `booking.com`.
 */
const DIRECT_CHANNELS = new Set(["", "direct", "hostex", "hostex_direct", "booking_site"]);

const MAX_CHANNEL_LENGTH = 60;

/**
 * `wait_accept` and `wait_pay` are not stays yet: they are skipped (null) until accepted, as is
 * any status Hostex adds later.
 */
export function mapReservationStatus(status: string): PmsReservation["status"] | null {
  return STATUS[status.trim().toLowerCase()] ?? null;
}

/**
 * A display name for the channel. A host-defined custom channel (for example "Instagram" on a
 * manual reservation) names a booking better than "Direct" does.
 */
export function channelName(
  channelType: string | null | undefined,
  customChannel?: string | null,
): string {
  const type = (channelType ?? "").trim().toLowerCase();
  const known = CHANNEL_NAMES[type];
  if (known) return known;
  const custom = customChannel?.trim();
  if (custom) return custom.slice(0, MAX_CHANNEL_LENGTH);
  if (DIRECT_CHANNELS.has(type)) return "Direct";
  const words = type.replaceAll("_", " ");
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, MAX_CHANNEL_LENGTH);
}

function wholeHour(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  if (typeof value === "string" && /^\d{1,2}$/.test(value.trim())) return Number(value.trim());
  return null;
}

const hhmm = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/**
 * Airbnb's check-in start: an hour 8–23 becomes `HH:00`. 24, 25, and 26 (midnight, 1am, and 2am
 * the next day) and `FLEXIBLE` have no same-day `HH:MM`, so they are null and the host fills it in.
 */
export function airbnbCheckInTime(value: number | string | null | undefined): string | null {
  const hour = wholeHour(value);
  return hour !== null && hour >= 8 && hour <= 23 ? hhmm(hour) : null;
}

/** Airbnb's latest checkout: an hour 0–23 becomes `HH:00`. */
export function airbnbCheckoutTime(value: number | string | null | undefined): string | null {
  const hour = wholeHour(value);
  return hour !== null && hour >= 0 && hour <= 23 ? hhmm(hour) : null;
}

/** The Airbnb listing linked to a property, whose rules give check-in and checkout times. */
export function airbnbListingId(property: HostexProperty): string | null {
  const channel = property.channels.find(
    (item) => item.channelType.trim().toLowerCase() === "airbnb" && item.listingId,
  );
  return channel?.listingId ?? null;
}

/** One Guidesk listing per Hostex property; `rules` is null when there is no Airbnb link. */
export function mapProperty(property: HostexProperty, rules: HostexAirbnbRules | null): PmsListing {
  return {
    externalId: property.id,
    name: property.title.trim() || `Hostex ${property.id}`,
    facts: {
      addressLine1: property.address,
      city: null,
      region: null,
      postalCode: null,
      country: null,
      checkInTime: airbnbCheckInTime(rules?.check_in_start_time),
      checkoutTime: airbnbCheckoutTime(rules?.check_out_before),
      maxGuests: null,
    },
    texts: [],
    amenities: [],
  };
}

/**
 * A stay, or null when its status is skipped. The stay code is the unique ID: a multi-stay
 * reservation shares one reservation code across its stays, which stays the booking reference.
 */
export function mapReservation(reservation: HostexReservation): PmsReservation | null {
  const status = mapReservationStatus(reservation.status);
  if (!status) return null;
  return {
    externalUid: reservation.stay_code ?? reservation.reservation_code,
    listingExternalId: reservation.property_id,
    status,
    checkInDate: reservation.check_in_date,
    checkoutDate: reservation.check_out_date,
    guestCount: reservation.number_of_guests,
    guestName: reservation.guest_name,
    bookingReference: reservation.reservation_code,
    channel: channelName(reservation.channel_type, reservation.custom_channel),
  };
}
