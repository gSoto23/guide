/** The parts of `web-push` 4.x that Guidesk uses (the package ships no types). */
declare module "web-push" {
  export interface PushSubscriptionInput {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }
  export interface RequestDetails {
    method: string;
    headers: Record<string, string | number>;
    body: Buffer | null;
    endpoint: string;
  }
  export interface RequestOptions {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
    contentEncoding?: "aes128gcm" | "aesgcm";
  }
  export function generateRequestDetails(
    subscription: PushSubscriptionInput,
    payload: string | Buffer | null,
    options: RequestOptions,
  ): RequestDetails;
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
}
