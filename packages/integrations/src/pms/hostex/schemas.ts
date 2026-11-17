import { z } from "zod";

/**
 * Allowlist schemas for Hostex Open API v3 responses (research R7, FR-030). `z.object` strips
 * every key it does not name, so guest phone and email, `guests[]`, remarks, custom fields,
 * rates, payment, and `check_in_details` (which holds lock codes) never leave the parse.
 *
 * Fields the mapping depends on (IDs, dates, status) are strict; cosmetic ones are lenient,
 * because Hostex is loose about types (empty objects may arrive as `[]`, numbers as strings).
 * Pages are read as arrays of unknown items and each item is parsed on its own, so one odd
 * reservation is skipped instead of failing a whole refresh.
 */

/** Hostex IDs are int64 numbers; digit strings are accepted too. */
const idSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform(String);

const countSchema = z.union([
  z.number().int().nonnegative(),
  z
    .string()
    .regex(/^\d+$/)
    .transform((value) => Number(value)),
]);

/** `YYYY-MM-DD` that is a real calendar date. */
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => {
      // `toISOString` throws on an invalid date, so check the time value first.
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
    },
    { message: "not a calendar date" },
  );

/**
 * A trimmed, non-empty string, or null for anything else. `.optional()` lets the key be absent:
 * in zod 4 a transformed `unknown` is otherwise a required key.
 */
const optionalText = z
  .unknown()
  .optional()
  .transform((value) => (typeof value === "string" && value.trim() ? value.trim() : null));

/** A positive whole number (also from a digit string), or null. */
const optionalPositiveInt = z
  .unknown()
  .optional()
  .transform((value) => {
    const number = typeof value === "string" && value.trim() ? Number(value) : value;
    return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : null;
  });

/** The envelope every v3 response uses. HTTP is 200 even for errors; `error_code` decides. */
export const envelopeSchema = z.object({
  error_code: countSchema,
  data: z.unknown().optional(),
});

/** `GET /accounts/me`: an opaque account ID, nothing personal. */
export const accountSchema = z.object({
  account_id: z.union([z.string().trim().min(1), z.number().int().nonnegative()]).transform(String),
});

const channelSchema = z.object({
  channel_type: z.string(),
  listing_id: z.union([z.string(), z.number()]).nullish(),
});

export interface HostexChannel {
  channelType: string;
  listingId: string | null;
}

/** A property's channels; unreadable entries are dropped instead of failing the property. */
const channelsSchema = z
  .array(z.unknown())
  .nullish()
  .transform((items): HostexChannel[] =>
    (items ?? []).flatMap((item) => {
      const parsed = channelSchema.safeParse(item);
      if (!parsed.success) return [];
      const listingId = parsed.data.listing_id == null ? "" : String(parsed.data.listing_id).trim();
      return [{ channelType: parsed.data.channel_type, listingId: listingId || null }];
    }),
  );

/** One property from `GET /properties`. Coordinates, groups, and tags are not kept. */
export const propertySchema = z.object({
  id: idSchema,
  title: z.string(),
  address: optionalText,
  channels: channelsSchema,
});
export type HostexProperty = z.output<typeof propertySchema>;

/** `GET /properties`: items stay unknown until `propertySchema` reads each one. */
export const propertiesPageSchema = z.object({
  properties: z.array(z.unknown()),
  total: countSchema,
});

/** `custom_channel` is `{id, name}`, or null, or possibly `[]`; only the name is kept. */
const customChannelName = z
  .unknown()
  .optional()
  .transform((value) =>
    value !== null && typeof value === "object" && "name" in value
      ? optionalText.parse((value as { name: unknown }).name)
      : null,
  );

/**
 * One stay from `GET /reservations`. Only these fields are read: no phone, email, `guests[]`,
 * remarks, channel remarks, custom fields, rates, payment, or `check_in_details`.
 */
export const reservationSchema = z.object({
  /** Shared by every stay of a multi-stay reservation. */
  reservation_code: z.string().trim().min(1),
  /** Unique per stay; equals the reservation code when there is one stay. */
  stay_code: optionalText,
  /** `0` when Hostex could not allocate the reservation to a property. */
  property_id: idSchema,
  channel_type: z.string().nullish(),
  custom_channel: customChannelName,
  check_in_date: dateSchema,
  check_out_date: dateSchema,
  number_of_guests: optionalPositiveInt,
  status: z.string(),
  guest_name: optionalText,
});
export type HostexReservation = z.output<typeof reservationSchema>;

/** `GET /reservations` has no total: a page shorter than the limit is the last one. */
export const reservationsPageSchema = z.object({
  reservations: z.array(z.unknown()),
});

/** An Airbnb hour: an integer, a digit string, or the word `FLEXIBLE`. */
const airbnbHour = z.union([z.number(), z.string()]).nullish().catch(null);

/**
 * `GET /listings/airbnb/price_and_rules`: only the check-in start and checkout hours. Its
 * `max_guests` is the number of guests included in the base price, not the capacity, so it is
 * deliberately not read (research R7).
 */
export const airbnbRulesSchema = z.object({
  check_in_start_time: airbnbHour,
  check_out_before: airbnbHour,
});
export type HostexAirbnbRules = z.output<typeof airbnbRulesSchema>;
