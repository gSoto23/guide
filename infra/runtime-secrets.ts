/**
 * Secrets for the containers, stored in AWS Secrets Manager and injected by ECS at start-up
 * (`valueFrom`). They never appear as plain environment variables in task definitions, so
 * read-only access to ECS does not reveal them (security review T103, SEC-06).
 */
import { isProduction } from "./config";
import { database } from "./database";
import {
  anthropicApiKey,
  betterAuthSecret,
  edgeSharedSecret,
  feedUrlPepper,
  googleClientId,
  googleClientSecret,
  vapidPrivateKey,
  vapidPublicKey,
} from "./secrets";

function runtimeSecret(name: string, value: $util.Input<string>): $util.Output<string> {
  const secret = new aws.secretsmanager.Secret(`${name}Runtime`, {
    recoveryWindowInDays: isProduction ? 7 : 0,
  });
  new aws.secretsmanager.SecretVersion(`${name}RuntimeVersion`, {
    secretId: secret.id,
    secretString: value,
  });
  return secret.arn;
}

export const databasePasswordArn = runtimeSecret("DatabasePassword", database.password);
const feedUrlPepperArn = runtimeSecret("FeedUrlPepper", feedUrlPepper.value);
/** Feature 006: the API reports push and stores subscriptions; the worker signs and sends. */
const vapidSecretArns = {
  VAPID_PUBLIC_KEY: runtimeSecret("VapidPublicKey", vapidPublicKey.value),
  VAPID_PRIVATE_KEY: runtimeSecret("VapidPrivateKey", vapidPrivateKey.value),
};

/** Secrets only the API needs. */
export const apiSecretArns = {
  DATABASE_PASSWORD: databasePasswordArn,
  BETTER_AUTH_SECRET: runtimeSecret("BetterAuthSecret", betterAuthSecret.value),
  GOOGLE_CLIENT_ID: runtimeSecret("GoogleClientId", googleClientId.value),
  GOOGLE_CLIENT_SECRET: runtimeSecret("GoogleClientSecret", googleClientSecret.value),
  EDGE_SHARED_SECRET: runtimeSecret("EdgeSharedSecret", edgeSharedSecret.value),
  FEED_URL_PEPPER: feedUrlPepperArn,
  ...vapidSecretArns,
};

/** The worker: the database, the feed-link pepper, the Claude key, and the push keys. */
export const workerSecretArns = {
  DATABASE_PASSWORD: databasePasswordArn,
  FEED_URL_PEPPER: feedUrlPepperArn,
  ANTHROPIC_API_KEY: runtimeSecret("AnthropicApiKey", anthropicApiKey.value),
  ...vapidSecretArns,
};
