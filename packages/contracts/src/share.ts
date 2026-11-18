import { z } from "zod";

/**
 * The Share screen routes under /properties/{propertyId}/share (feature 004 contracts/http-api.md).
 * Stay link URLs and confirmation codes come only from the step-up routes, never the overview.
 */
export const STAY_LINK_STATUS_VALUES = [
  "not_created",
  "active",
  "device_limit",
  "revoked",
  "ended",
] as const;
export type StayLinkStatus = (typeof STAY_LINK_STATUS_VALUES)[number];

export interface ShareStay {
  stayId: string;
  checkInDate: string;
  checkoutDate: string;
  channel: string;
  mayBeBlock: boolean;
  link: {
    status: StayLinkStatus;
    devices: number;
    firstOpenedAt: string | null;
    valuesShown: number;
    lockedUntil: string | null;
    lastCopiedAt: string | null;
  };
}

export interface ShareOverview {
  published: boolean;
  propertyName: string;
  propertyLink: { url: string; createdAt: string } | null;
  opensLast30Days: number;
  templates: { es: string; en: string } | null;
  /** Owners and admins only. */
  settings?: { requireConfirmationCode: boolean };
  /** Owners and admins only. */
  stays?: ShareStay[];
}

export const regeneratePropertyLinkSchema = z.object({ confirm: z.literal(true) }).strict();

export const shareSettingsSchema = z.object({ requireConfirmationCode: z.boolean() }).strict();
export type ShareSettingsBody = z.infer<typeof shareSettingsSchema>;

export interface StayLinkCopy {
  url: string;
  confirmationCode: string | null;
}

export const stayMessageSchema = z
  .object({ language: z.enum(["es", "en"]), withValues: z.boolean().default(false) })
  .strict();
export type StayMessageBody = z.infer<typeof stayMessageSchema>;

export interface StayMessage {
  text: string;
}
