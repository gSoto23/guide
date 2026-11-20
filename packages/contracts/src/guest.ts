import { z } from "zod";
import type { GuideDocument } from "./guide-document.js";
import {
  BENEFIT_VALUES,
  LOCKED_FIELD_KIND_VALUES,
  RECOMMENDATION_CATEGORY_VALUES,
  SECTION_KIND_VALUES,
} from "./values.js";

/**
 * Guest routes under /api/v1/guest (feature 004 contracts/http-api.md). Reached only through the
 * guide origin; no member session. Locked values appear only in `RevealResponse`.
 */
type GuestLanguage = "es" | "en";

const publicIdSchema = z.string().regex(/^[a-z2-7]{26}$/);
const stayTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const guestGuideQuerySchema = z.object({ lang: z.enum(["es", "en"]).optional() }).strict();

export interface GuestMedia {
  kind: "image" | "video";
  /** Stable guest address that redirects to a short-lived signed URL (research R11). */
  url: string;
  /** Smaller image variant for narrow screens, when it exists. */
  smallUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface GuestRecommendation {
  name: string;
  category: (typeof RECOMMENDATION_CATEGORY_VALUES)[number];
  url: string | null;
  address: string | null;
  /** True when the host declared a commission, discount, or other benefit (FR-008, PC-07). */
  benefit: boolean;
  benefitKind: (typeof BENEFIT_VALUES)[number] | null;
  personalTip: boolean;
}

export interface GuestItem {
  id: string;
  kind: "text" | "image" | "video" | "recommendation" | "fact";
  /** The language this item is shown in; differs from the guide language when untranslated. */
  language: GuestLanguage;
  translated: boolean;
  doc: GuideDocument | null;
  fact?: {
    key: "check_in_time" | "checkout_time" | "max_guests" | "address";
    value: string | null;
  };
  media?: GuestMedia | null;
  recommendation?: GuestRecommendation;
}

export interface GuestSection {
  id: string;
  kind: (typeof SECTION_KIND_VALUES)[number];
  title: string | null;
  items: GuestItem[];
}

export interface GuestLockedField {
  id: string;
  kind: (typeof LOCKED_FIELD_KIND_VALUES)[number];
  label: string;
  /** False when the published guide references a field that has no value (edge case). */
  set: boolean;
}

/** The public guide in one language (FR-003 to FR-018). Never carries a locked value. */
export interface GuestGuide {
  publicId: string;
  language: GuestLanguage;
  languages: GuestLanguage[];
  primaryLanguage: GuestLanguage;
  propertyName: string;
  timeZone: string;
  country: string | null;
  emergencyNumber: string | null;
  facts: {
    checkInTime: string | null;
    checkoutTime: string | null;
    maxGuests: number | null;
    address: string | null;
  };
  publishedAt: string | null;
  sections: GuestSection[];
  lockedFields: GuestLockedField[];
  /** The Wi-Fi password only when the host made it public (FR-018). */
  wifi: { fieldId: string | null; password: string | null };
  /** Feature 009: whether the Explore tab shows (host tips or selected experiences). */
  explore: { visible: boolean };
  /** Feature 008: whether the property has visible extras. */
  extras: { visible: boolean };
  /** Feature 015: show the "Made with Guidesk" credit (Free-plan workspaces only). */
  credit: boolean;
  /** Feature 016: the property's cover photo, with the host's description. */
  cover: {
    url: string;
    smallUrl: string | null;
    width: number | null;
    height: number | null;
    alt: string;
  } | null;
}

export const stayExchangeSchema = z.object({ token: stayTokenSchema }).strict();
export type StayExchangeBody = z.infer<typeof stayExchangeSchema>;

export interface StayExchangeResponse {
  guideUrl: string;
  notice: null | "ended" | "device_limit";
}

export const guestSessionQuerySchema = z.object({ publicId: publicIdSchema }).strict();

export interface GuestSession {
  state: "public" | "before" | "inside" | "ended";
  stay?: {
    checkInDate: string;
    checkoutDate: string;
    checkInTime: string | null;
    checkoutTime: string | null;
  };
  opensAt?: string;
  closesAt?: string;
  timeZone?: string;
  codeRequired: boolean;
  verified: boolean;
  lockedUntil: string | null;
}

export const guestVerifySchema = z
  .object({ publicId: publicIdSchema, code: z.string().trim().min(1).max(20) })
  .strict();
export type GuestVerifyBody = z.infer<typeof guestVerifySchema>;

export const guestRevealSchema = z.object({ publicId: publicIdSchema, fieldId: z.uuid() }).strict();
export type GuestRevealBody = z.infer<typeof guestRevealSchema>;

export interface RevealResponse {
  value: string;
}

/** Feature 009 adds `explore`: one Explore open per property and day (FR-011). */
export const guestOpenSchema = z
  .object({ publicId: publicIdSchema, kind: z.enum(["property", "stay", "explore"]) })
  .strict();
export type GuestOpenBody = z.infer<typeof guestOpenSchema>;
