import { z } from "zod";

/**
 * Allowlist schemas for the Beds24 API V2 responses Guidesk reads (research R7, T090). `z.object`
 * strips every key it does not name, so guest contact data, notes, comments, messages, custom
 * fields, info items, templates, unit notes, directions, and channel settings are dropped here,
 * before any mapping, logging, or storage (FR-030, AC-SEC-012).
 *
 * Fields the mapping can do without are lenient: a wrong type becomes null instead of failing the
 * whole import. Identifiers, booking statuses, stay dates, and tokens are strict.
 */

/** An integer ID. Beds24 documents integers; a numeric string is accepted too. */
const id = z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)]);

/** A whole number that may arrive as a numeric string. */
const wholeNumber = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative());

/** Optional text: numbers become strings, and any other unexpected value becomes null. */
const text = z
  .union([z.string(), z.number().transform(String)])
  .nullish()
  .catch(null);

/** An optional count (guests, capacity); an unreadable value becomes null. */
const count = wholeNumber.nullish().catch(null);

/**
 * `featureCodes` is documented as an array of arrays of strings. A flat array is accepted too,
 * and anything that is not a string is ignored.
 */
const featureCodes = z
  .unknown()
  .optional()
  .transform((value): string[] =>
    Array.isArray(value)
      ? value.flat().filter((code): code is string => typeof code === "string")
      : [],
  );

/** `YYYY-MM-DD`, also when a time follows it. */
const stayDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .transform((value) => value.slice(0, 10));

const pages = z.object({ nextPageExists: z.boolean() }).nullish();

export const beds24SetupSchema = z.object({
  token: z.string().min(1),
  expiresIn: wholeNumber,
  refreshToken: z.string().min(1),
});

export const beds24TokenSchema = z.object({
  token: z.string().min(1),
  expiresIn: wholeNumber,
});

/** `token.ownerId` is the account ID; the API has no account name. */
export const beds24DetailsSchema = z.object({
  validToken: z.boolean().optional(),
  token: z.object({ ownerId: id }).nullish(),
});

/** Only the three texts Guidesk imports; directions, policies, and custom questions are dropped. */
const propertyText = z.object({
  language: text,
  headline: text,
  propertyDescription: text,
  houseRules: text,
});

const roomTypeText = z.object({
  language: text,
  roomDescription: text,
});

/** Templates, units (and their notes), and offers are not named, so they are dropped. */
export const beds24RoomTypeSchema = z.object({
  id,
  name: text,
  maxPeople: count,
  featureCodes,
  texts: z.array(roomTypeText).nullish().catch(null),
});

/** Contact fields, templates, booking questions, and payment settings are not named. */
export const beds24PropertySchema = z.object({
  id,
  name: text,
  address: text,
  city: text,
  state: text,
  postcode: text,
  country: text,
  checkInStart: text,
  checkOutEnd: text,
  featureCodes,
  texts: z.array(propertyText).nullish().catch(null),
  roomTypes: z.array(beds24RoomTypeSchema).nullish(),
});

/**
 * The booking fields the mapping needs. Email, phone, mobile, address, comments, notes, message,
 * custom fields, info items, invoice items, and references are not named, so they are dropped.
 */
export const beds24BookingSchema = z.object({
  id,
  propertyId: id,
  roomId: id,
  status: z.string(),
  arrival: stayDate,
  departure: stayDate,
  numAdult: count,
  numChild: count,
  firstName: text,
  lastName: text,
  channel: text,
  apiSource: text,
});

/** A `success: false` answer fails the parse, even with HTTP 200. */
export const beds24PropertiesPageSchema = z.object({
  success: z.literal(true).optional(),
  pages,
  data: z.array(beds24PropertySchema),
});

export const beds24BookingsPageSchema = z.object({
  success: z.literal(true).optional(),
  pages,
  data: z.array(beds24BookingSchema),
});

export type Beds24Property = z.output<typeof beds24PropertySchema>;
export type Beds24RoomType = z.output<typeof beds24RoomTypeSchema>;
export type Beds24Booking = z.output<typeof beds24BookingSchema>;
