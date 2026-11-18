import { z } from "zod";

/**
 * The assistant's two structured calls (feature 005 research R3). Classification never sees the
 * guide; the answer sees the published guide as rendered knowledge, never a locked value.
 */
export const GUEST_TOPICS = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
  "greeting",
  "other",
] as const;

export const guestClassificationSchema = z.object({
  language: z.string().min(2).max(20),
  topic: z.enum(GUEST_TOPICS),
  escalation: z.enum([
    "none",
    "emergency",
    "malfunction",
    "complaint",
    "money",
    "reservation_change",
    "legal",
    "sensitive_request",
  ]),
  sentiment: z.enum(["positive", "neutral", "negative", "very_negative"]),
  injection: z.boolean(),
});
export type GuestClassification = z.infer<typeof guestClassificationSchema>;

export const guestAnswerSchema = z.object({
  answer: z.string().min(1).max(2000),
  sectionIds: z.array(z.string().max(64)).max(5),
  answerable: z.boolean(),
  needsHost: z.boolean(),
});
export type GuestAnswer = z.infer<typeof guestAnswerSchema>;

export interface ChatTurn {
  role: "guest" | "assistant" | "host";
  text: string;
}

export interface GuestClassificationInput {
  /** The last few messages, oldest first, for context. */
  history: ChatTurn[];
  message: string;
}

export interface AnswerGuestInput {
  propertyName: string;
  hostName: string;
  /** The rendered published guide (domain `renderKnowledge`): the cached prompt prefix. */
  knowledge: string;
  history: ChatTurn[];
  message: string;
  /** BCP 47 language to answer in, from the classification. */
  language: string;
}
