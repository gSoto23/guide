import { z } from "zod";
import type { GuestPayment, RequestPayment } from "./payments.js";

/**
 * Feature 008 value lists (data model). Kept out of `values.ts`, which every portal route that
 * imports a value downloads; the portal keeps its own copies in `apps/portal/lib/extras.ts`, checked
 * against these types (plan Performance Budget).
 */
export const EXTRA_CURRENCY_VALUES = ["USD", "CRC", "MXN", "EUR", "COP", "GTQ"] as const;
export const EXTRA_DATE_RANGE_VALUES = ["stay", "before_arrival"] as const;
export const EXTRA_TURNOVER_VALUES = ["early_check_in", "late_checkout"] as const;
export const SERVICE_REQUEST_STATUS_VALUES = [
  "waiting",
  "confirmed",
  "declined",
  "cancelled",
  "host_cancelled",
  "expired",
] as const;
/** Reasons a member picks; `stay` is set by the system when a stay is cancelled. */
export const SERVICE_REQUEST_REASON_VALUES = [
  "unavailable",
  "fully_booked",
  "too_late",
  "other",
] as const;
export const EXTRA_SUGGESTION_VALUES = [
  "airport_pickup",
  "extra_cleaning",
  "grocery_stocking",
  "late_checkout",
] as const;

/**
 * Extras and add-on requests (feature 008 contracts/http-api.md). Prices and names in a request
 * always come from the catalog, never from the body; the stay always comes from the guest session.
 */
export type ExtraCurrency = (typeof EXTRA_CURRENCY_VALUES)[number];
export type ExtraDateRange = (typeof EXTRA_DATE_RANGE_VALUES)[number];
export type ExtraTurnover = (typeof EXTRA_TURNOVER_VALUES)[number];
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUS_VALUES)[number];
export type ServiceRequestReason = (typeof SERVICE_REQUEST_REASON_VALUES)[number] | "stay";
export type ServiceRequestAnswerReason = (typeof SERVICE_REQUEST_REASON_VALUES)[number];
export type ExtraSuggestion = (typeof EXTRA_SUGGESTION_VALUES)[number];

const publicIdSchema = z.string().regex(/^[a-z2-7]{26}$/);
const languageSchema = z.enum(["es", "en"]);
const nameText = z.string().trim().min(1).max(80);
const descriptionText = z.string().trim().max(500);

export const extraInputSchema = z
  .object({
    sourceLanguage: languageSchema,
    name: z.object({ es: nameText.optional(), en: nameText.optional() }).strict(),
    description: z
      .object({ es: descriptionText.optional(), en: descriptionText.optional() })
      .strict(),
    price: z
      .number()
      .min(0)
      .max(100_000)
      .refine((value) => Math.round(value * 100) === value * 100, "At most two decimals"),
    currency: z.enum(EXTRA_CURRENCY_VALUES),
    leadTimeHours: z.int().min(0).max(720),
    weekdays: z
      .array(z.int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((values) => new Set(values).size === values.length, "No duplicates"),
    needsDate: z.boolean(),
    needsTime: z.boolean(),
    dateRange: z.enum(EXTRA_DATE_RANGE_VALUES),
    maxPerStay: z.int().min(1).max(10),
    preApproved: z.boolean(),
    turnover: z.enum(EXTRA_TURNOVER_VALUES).nullable(),
    visible: z.boolean(),
    /** Feature 016: an optional photo, a ready image of this workspace (`null` removes it). */
    mediaId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.name[value.sourceLanguage]), {
    message: "The source language needs a name",
    path: ["name"],
  })
  .refine((value) => !value.needsTime || value.needsDate || value.turnover !== null, {
    message: "A time needs a date",
    path: ["needsTime"],
  })
  .refine((value) => value.turnover === null || !value.needsDate, {
    message: "Early check-in and late checkout use the stay's dates",
    path: ["needsDate"],
  });
export type ExtraInput = z.infer<typeof extraInputSchema>;

export const extraUpdateSchema = z
  .object({ version: z.int().min(1), extra: extraInputSchema })
  .strict();
export type ExtraUpdateBody = z.infer<typeof extraUpdateSchema>;

export const extrasOrderSchema = z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict();
export const extraCopySchema = z
  .object({ propertyIds: z.array(z.uuid()).min(1).max(100) })
  .strict();

export interface MemberExtra extends ExtraInput {
  id: string;
  propertyId: string;
  position: number;
  version: number;
  updatedAt: string;
  /** Feature 016: the photo for members (signed URLs, valid for 15 minutes). */
  media: { url: string; smallUrl: string | null } | null;
}

export interface MemberExtras {
  extras: MemberExtra[];
  canEdit: boolean;
}

/** `GET /api/v1/guest/guides/{publicId}/extras`: visible extras, in the guest's language. */
export interface GuestExtra {
  id: string;
  name: string;
  description: string;
  language: "es" | "en";
  price: number;
  currency: ExtraCurrency;
  leadTimeHours: number;
  needsDate: boolean;
  needsTime: boolean;
  dateRange: ExtraDateRange;
  weekdays: number[];
  maxPerStay: number;
  turnover: ExtraTurnover | null;
  /** Feature 016: the extra's photo on the guest media path, or null. */
  image: GuestImage | null;
}

/** A photo for guests: stable guest media paths, sizes for layout. */
export interface GuestImage {
  url: string;
  smallUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface GuestExtras {
  extras: GuestExtra[];
}

export const guestRequestsQuerySchema = z.object({ publicId: publicIdSchema }).strict();

export const guestServiceRequestSchema = z
  .object({
    publicId: publicIdSchema,
    extraId: z.uuid(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    quantity: z.int().min(1).max(10),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type GuestServiceRequestBody = z.infer<typeof guestServiceRequestSchema>;

export const guestCancelRequestSchema = z.object({ publicId: publicIdSchema }).strict();

export interface GuestServiceRequest {
  id: string;
  extraId: string | null;
  name: string;
  price: number;
  currency: ExtraCurrency;
  requestedDate: string | null;
  requestedTime: string | null;
  quantity: number;
  status: ServiceRequestStatus;
  reasonCode: ServiceRequestReason | null;
  reasonText: string | null;
  createdAt: string;
  /** Feature 013: null when online payment isn't possible for this request. */
  payment: GuestPayment | null;
}

/** `GET /api/v1/guest/extras/requests`: whether this device may request, and its stay's requests. */
export interface GuestServiceRequests {
  canRequest: boolean;
  reason: null | "no_session" | "ended" | "verify";
  requests: GuestServiceRequest[];
}

export const serviceRequestsQuerySchema = z
  .object({
    status: z.enum(["waiting", "confirmed", "closed", "all"]).optional(),
    propertyId: z.uuid().optional(),
    before: z
      .string()
      .regex(/^\d{1,6}$/)
      .optional(),
    lang: z.enum(["es", "en"]).optional(),
  })
  .strict();
export type ServiceRequestsQuery = z.infer<typeof serviceRequestsQuerySchema>;

export const serviceRequestAnswerSchema = z
  .object({
    reasonCode: z.enum(SERVICE_REQUEST_REASON_VALUES),
    reasonText: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type ServiceRequestAnswerBody = z.infer<typeof serviceRequestAnswerSchema>;

export interface MemberServiceRequest extends Omit<GuestServiceRequest, "payment"> {
  /** Feature 013: the request's latest order, or null when none was started. */
  payment: RequestPayment | null;
  propertyId: string;
  propertyName: string;
  stay: { checkInDate: string; checkoutDate: string; guestName: string | null };
  note: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  expiresAt: string;
}

export interface ServiceRequestPage {
  items: MemberServiceRequest[];
  next: string | null;
  waiting: number;
}
