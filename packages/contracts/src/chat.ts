import { z } from "zod";

/**
 * The in-guide chat (feature 005 contracts/http-api.md): guest routes on the guide origin, member
 * routes for conversations, and assistant settings. No guest contact data anywhere.
 */
const publicIdSchema = z.string().regex(/^[a-z2-7]{26}$/);

export const guestChatQuerySchema = z
  .object({ publicId: publicIdSchema, after: z.coerce.number().int().min(0).optional() })
  .strict();

/** Guest messages are plain text up to this many characters (FR-006). */
export const CHAT_MESSAGE_MAX = 2000;

/** Longer texts pass validation so the API can answer `message_too_long` (contracts/http-api.md). */
export const postChatMessageSchema = z
  .object({
    publicId: publicIdSchema,
    text: z.string().trim().min(1).max(20_000),
    language: z.enum(["es", "en"]),
    clientId: z.uuid(),
  })
  .strict();
export type PostChatMessageBody = z.infer<typeof postChatMessageSchema>;

export type ChatAuthor = "guest" | "assistant" | "host";
export type ChatMessageKind = "text" | "holding" | "emergency" | "pointer" | "greeting" | "pause";

export interface ChatSectionRef {
  id: string;
  title: string;
}

export interface GuestChatMessage {
  seq: number;
  author: ChatAuthor;
  kind: ChatMessageKind;
  body: string;
  sections: ChatSectionRef[];
  /** The host's display name for host messages. */
  authorName: string | null;
  /** For emergency cards: the local number and the guide's emergency text. */
  emergency?: { number: string | null; text: string | null };
  createdAt: string;
}

export interface GuestChat {
  intro: {
    propertyName: string;
    hostName: string;
    emergencyNumber: string | null;
    /** Message keys of suggested questions (guest catalog `chat.suggestions.*`). */
    suggestions: string[];
  };
  conversation: { status: "open" | "needs_host"; pending: boolean } | null;
  messages: GuestChatMessage[];
}

export interface PostChatMessageResponse {
  message: GuestChatMessage;
  pending: boolean;
}

export const NEEDS_HOST_REASONS = [
  "emergency",
  "malfunction",
  "complaint",
  "money",
  "reservation_change",
  "legal",
  "not_confident",
  "draft_ready",
  "check_failed",
  "limit",
  "unavailable",
] as const;
export type NeedsHostReasonValue = (typeof NEEDS_HOST_REASONS)[number];

export interface ConversationSummary {
  id: string;
  status: "open" | "needs_host";
  reason: NeedsHostReasonValue | null;
  stay: { checkInDate: string; checkoutDate: string } | null;
  lastMessageAt: string;
  lastMessage: { author: ChatAuthor; body: string } | null;
}

export interface MemberChatMessage {
  id: string;
  seq: number;
  author: ChatAuthor;
  kind: ChatMessageKind;
  body: string;
  sections: ChatSectionRef[];
  authorName: string | null;
  createdAt: string;
}

export interface MemberTrace {
  id: string;
  /** The reply it produced, or null for drafts and holds. */
  messageId: string | null;
  topic: string | null;
  decision: "answered" | "drafted" | "held" | "pointer" | "greeting" | "paused";
  reason: NeedsHostReasonValue | null;
  autonomy: "draft" | "auto";
  sections: ChatSectionRef[];
  checks: { check: string; passed: boolean }[];
  sentBy: string | null;
  edited: boolean;
  createdAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  propertyId: string;
  language: "es" | "en";
  messages: MemberChatMessage[];
  draft: {
    id: string;
    body: string;
    sections: ChatSectionRef[];
    traceId: string | null;
    createdAt: string;
  } | null;
  traces: MemberTrace[];
}

export const sendDraftSchema = z
  .object({
    text: z.string().trim().min(1).max(2000).optional(),
    acknowledgeWarnings: z.boolean().optional(),
  })
  .strict();
export type SendDraftBody = z.infer<typeof sendDraftSchema>;

export const chatReplySchema = z
  .object({ text: z.string().trim().min(1).max(2000), acknowledgeWarnings: z.boolean().optional() })
  .strict();
export type ChatReplyBody = z.infer<typeof chatReplySchema>;

export const autonomySchema = z.enum(["draft", "auto"]);
export const workspaceAssistantSchema = z.object({ autonomy: autonomySchema }).strict();
export const propertyAssistantSchema = z.object({ override: autonomySchema.nullable() }).strict();
export interface WorkspaceAssistantSettings {
  autonomy: "draft" | "auto";
}
export interface PropertyAssistantSettings {
  override: "draft" | "auto" | null;
  effective: "draft" | "auto";
}
