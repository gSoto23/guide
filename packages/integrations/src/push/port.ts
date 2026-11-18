/**
 * Web push to a member's devices (feature 006 research R7, FR-015 to FR-018). The payload is a title,
 * a short body, and a portal link; it never carries guest text, codes, or contact data (SEC-20).
 */
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** A portal path or URL the notification opens. */
  url: string;
  /** Collapses repeated alerts for the same conversation on the device. */
  tag?: string;
  urgency?: "normal" | "high";
}

/** `gone`: the push service no longer knows the subscription (404 or 410); delete it. */
export type PushOutcome = "sent" | "gone" | "failed";

export interface PushPort {
  /** The VAPID public key browsers subscribe with, or null when push isn't configured. */
  readonly publicKey: string | null;
  send(subscription: PushSubscriptionKeys, message: PushMessage): Promise<PushOutcome>;
}

/** The push service limit is 4 KB; Guidesk payloads stay well under it. */
export const PUSH_BODY_MAX = 120;
