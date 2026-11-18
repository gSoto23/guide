/**
 * Secrets stored by SST in AWS (set with `pnpm sst secret set <Name> <value> --stage <stage>`).
 * Values never live in the repository (constitution, Principle VI).
 */
export const betterAuthSecret = new sst.Secret("BetterAuthSecret");
export const googleClientId = new sst.Secret("GoogleClientId");
export const googleClientSecret = new sst.Secret("GoogleClientSecret");
/** Shared secret that only requests coming through CloudFront carry (research R7). */
export const edgeSharedSecret = new sst.Secret("EdgeSharedSecret");

/** Claude API key for listing extraction (feature 002, research R6). Only the worker uses it. */
export const anthropicApiKey = new sst.Secret("AnthropicApiKey");
/** Secret for calendar-link fingerprints, at least 32 characters (feature 002, T006). */
export const feedUrlPepper = new sst.Secret("FeedUrlPepper");
/**
 * Web push VAPID key pair, base64url (feature 006 research R7, SEC-20). Generate once per stage with
 * `npx web-push generate-vapid-keys`; rotating them drops every subscribed device.
 */
export const vapidPublicKey = new sst.Secret("VapidPublicKey");
export const vapidPrivateKey = new sst.Secret("VapidPrivateKey");

export const allSecrets = [
  betterAuthSecret,
  googleClientId,
  googleClientSecret,
  edgeSharedSecret,
  anthropicApiKey,
  feedUrlPepper,
  vapidPublicKey,
  vapidPrivateKey,
];
