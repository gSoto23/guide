import { z } from "zod";
import { databaseUrlFromParts } from "@guidesk/db";
import { loadIntegrationSettings, type IntegrationSettings } from "@guidesk/integrations";

/**
 * API configuration (12-factor). Locally from .env; in AWS from SST links, which arrive as
 * SST_RESOURCE_<Name> JSON environment variables (ADR-0009). Secrets never live in the repo.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    /**
     * Optional login for the request pool. Before production it should be a role that can only
     * become guidesk_app (security review T103); until then requests use DATABASE_URL and switch
     * to guidesk_app with SET LOCAL ROLE.
     */
    DATABASE_APP_URL: z.string().min(1).optional(),
    DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(50).default(10),
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    PORTAL_URL: z.url(),
    /** The guest guide's origin (feature 004 research R2): the only origin allowed on guest routes. */
    GUIDE_URL: z.url().default("http://127.0.0.1:3001"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    EDGE_SHARED_SECRET: z.string().optional(),
    EMAIL_TRANSPORT: z.enum(["smtp", "ses"]).default("smtp"),
    EMAIL_FROM: z.string().min(3).default("no-reply@guidesk.local"),
    SMTP_HOST: z.string().default("localhost"),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SES_CONFIGURATION_SET: z.string().optional(),
    SENTRY_DSN: z.string().optional(),
    /** Feature 011: where hosts ask Guidesk for a plan change; optional until the founder sets it. */
    PLAN_CONTACT_EMAIL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.email().optional(),
    ),
    /**
     * Proxy hops in front of the API whose X-Forwarded-For entries are trusted: CloudFront and the
     * load balancer in AWS (2); the portal's dev proxy locally (1). Security review T103.
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
  })
  .refine((env) => env.NODE_ENV !== "production" || Boolean(env.EDGE_SHARED_SECRET), {
    message: "EDGE_SHARED_SECRET is required in production (research R7)",
    path: ["EDGE_SHARED_SECRET"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.PORTAL_URL.startsWith("https://"), {
    message: "PORTAL_URL must use HTTPS in production (SEC-11)",
    path: ["PORTAL_URL"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.GUIDE_URL.startsWith("https://"), {
    message: "GUIDE_URL must use HTTPS in production (SEC-11)",
    path: ["GUIDE_URL"],
  });

export type ApiConfig = z.infer<typeof schema> & {
  /** Feature 002 adapters: keys, storage, sandbox, AI, PMS, and flags (T006). */
  integrations: IntegrationSettings;
};

function readSstResource(
  env: NodeJS.ProcessEnv,
  name: string,
): Record<string, unknown> | undefined {
  const raw = env[`SST_RESOURCE_${name}`];
  if (!raw) {
    return undefined;
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Fills missing variables from SST links (Database and secrets). */
function withSstResources(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...env };
  // AWS: separate variables, with the password injected from Secrets Manager (T103).
  merged.DATABASE_URL ??= databaseUrlFromParts(env);
  const database = readSstResource(env, "Database");
  if (!merged.DATABASE_URL && database) {
    const user = encodeURIComponent(String(database.username));
    const password = encodeURIComponent(String(database.password));
    merged.DATABASE_URL = `postgres://${user}:${password}@${String(database.host)}:${String(database.port)}/${String(database.database)}`;
  }
  const secrets: Record<string, string> = {
    BETTER_AUTH_SECRET: "BetterAuthSecret",
    GOOGLE_CLIENT_ID: "GoogleClientId",
    GOOGLE_CLIENT_SECRET: "GoogleClientSecret",
    EDGE_SHARED_SECRET: "EdgeSharedSecret",
  };
  for (const [variable, resource] of Object.entries(secrets)) {
    const value = readSstResource(env, resource)?.value;
    if (!merged[variable] && typeof value === "string" && value.length > 0) {
      merged[variable] = value;
    }
  }
  return merged;
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const merged = withSstResources(env);
  const result = schema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid API configuration:\n${issues.join("\n")}`);
  }
  // The API never calls the model (extraction runs in the worker), so it never holds the key.
  const integrations = loadIntegrationSettings(merged, {
    production: result.data.NODE_ENV === "production",
    usesLlm: false,
  });
  return { ...result.data, integrations };
}

export const API_CONFIG = Symbol("API_CONFIG");
