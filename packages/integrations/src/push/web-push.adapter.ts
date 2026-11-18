import { generateRequestDetails } from "web-push";
import {
  PUSH_BODY_MAX,
  type PushMessage,
  type PushOutcome,
  type PushPort,
  type PushSubscriptionKeys,
} from "./port.js";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  /** A `mailto:` or `https:` contact for the push services (the portal URL). */
  subject: string;
}

/** A day: an alert older than that is no longer useful. */
const TTL_SECONDS = 24 * 60 * 60;
const TIMEOUT_MS = 10_000;

/**
 * Standard Web Push with VAPID (RFC 8030, 8291, 8292). `web-push` builds the encrypted request;
 * sending goes through `fetch`, injectable for tests.
 */
export class WebPushAdapter implements PushPort {
  readonly publicKey: string;

  constructor(
    private readonly keys: VapidKeys,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.publicKey = keys.publicKey;
  }

  async send(subscription: PushSubscriptionKeys, message: PushMessage): Promise<PushOutcome> {
    const payload = JSON.stringify({
      title: message.title,
      body: message.body.slice(0, PUSH_BODY_MAX),
      url: message.url,
      ...(message.tag ? { tag: message.tag } : {}),
    });
    let request;
    try {
      request = generateRequestDetails(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
        {
          vapidDetails: this.keys,
          TTL: TTL_SECONDS,
          urgency: message.urgency ?? "normal",
          contentEncoding: "aes128gcm",
        },
      );
    } catch {
      // Malformed keys from a browser: the subscription can never work.
      return "gone";
    }
    try {
      const response = await this.fetchImpl(request.endpoint, {
        method: request.method,
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [name, String(value)]),
        ),
        body: request.body ?? undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404 || response.status === 410) return "gone";
      return response.ok ? "sent" : "failed";
    } catch {
      return "failed";
    }
  }
}
