import { z } from "zod";
import type { ChatAuthor, ChatSectionRef, NeedsHostReasonValue } from "./chat.js";

/** The host inbox, conversation actions, the copilot, and push (feature 006 contracts/http-api.md). */
export const INBOX_TABS = ["needs", "all", "done"] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const inboxQuerySchema = z
  .object({
    tab: z.enum(INBOX_TABS).default("needs"),
    propertyId: z.uuid().optional(),
    before: z.string().max(200).optional(),
  })
  .strict();
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

export interface InboxItem {
  id: string;
  propertyId: string;
  propertyName: string;
  status: "open" | "needs_host" | "done";
  reason: NeedsHostReasonValue | null;
  stay: { checkInDate: string; checkoutDate: string } | null;
  channel: "guide_chat";
  lastMessageAt: string;
  lastMessage: { author: ChatAuthor; excerpt: string } | null;
  takenOverBy: string | null;
  takenOver: boolean;
  replying: string[];
}

export interface TrustSuggestion {
  propertyId: string;
  propertyName: string;
  topic: string;
  count: number;
  scope: "property" | "workspace";
}

export interface InboxPage {
  items: InboxItem[];
  next: string | null;
  hasPublishedGuide: boolean;
  suggestions: TrustSuggestion[];
}

export const takeoverSchema = z.object({ on: z.boolean() }).strict();
export const dismissSuggestionSchema = z
  .object({ propertyId: z.uuid(), topic: z.string().min(1).max(40) })
  .strict();

export const COPILOT_MESSAGE_MAX = 4000;
export const copilotRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(COPILOT_MESSAGE_MAX),
    bookingStatus: z.enum(["inquiry", "confirmed"]),
    language: z.enum(["es", "en"]).default("es"),
  })
  .strict();
export type CopilotRequest = z.infer<typeof copilotRequestSchema>;

export interface CopilotDraft {
  id: string;
  status: "pending" | "done";
  outcome: "drafted" | "limited" | "unavailable" | "failed" | null;
  draft: string | null;
  sections: ChatSectionRef[];
  checks: { check: string; passed: boolean }[];
  passed: boolean;
  removed: ("link" | "email" | "phone")[];
  caution: string | null;
  covered: boolean | null;
  createdAt: string;
}

export const pushSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .max(2048)
      .refine((value) => value.startsWith("https://"), "The endpoint must be https"),
    keys: z
      .object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) })
      .strict(),
    device: z.string().regex(/^[a-z0-9-]{1,40}$/),
  })
  .strict();
export type PushSubscriptionBody = z.infer<typeof pushSubscriptionSchema>;

export interface PushStatus {
  available: boolean;
  publicKey: string | null;
  devices: { id: string; device: string; createdAt: string }[];
}
