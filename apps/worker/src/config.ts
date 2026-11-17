import { loadIntegrationSettings, type IntegrationSettings } from "@guidesk/integrations";

/** Worker configuration read from the environment (secrets come from Secrets Manager in AWS). */
export interface WorkerConfig {
  databaseUrl: string;
  email: {
    transport: "smtp" | "ses";
    from: string;
    smtpHost: string;
    smtpPort: number;
    sesConfigurationSet: string | undefined;
  };
  /** Feature 002 adapters: keys, storage, sandbox, AI, PMS, and flags (T006). */
  integrations: IntegrationSettings;
}

/** Same rules as @guidesk/db databaseUrlFromParts; kept here so the worker stays dependency-light. */
function databaseUrlFromParts(env: NodeJS.ProcessEnv): string | undefined {
  const { DATABASE_HOST, DATABASE_PORT, DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD } = env;
  if (!DATABASE_HOST || !DATABASE_NAME || !DATABASE_USER || !DATABASE_PASSWORD) return undefined;
  const url = new URL(`postgres://${DATABASE_HOST}`);
  url.port = DATABASE_PORT ?? "5432";
  url.pathname = `/${DATABASE_NAME}`;
  url.username = DATABASE_USER;
  url.password = DATABASE_PASSWORD;
  if (env.DATABASE_SSLMODE) url.searchParams.set("sslmode", env.DATABASE_SSLMODE);
  return url.toString();
}

function databaseUrlFrom(env: NodeJS.ProcessEnv): string | undefined {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  // AWS: separate variables, with the password injected from Secrets Manager (T103).
  const fromParts = databaseUrlFromParts(env);
  if (fromParts) return fromParts;
  const raw = env.SST_RESOURCE_Database;
  if (!raw) return undefined;
  const db = JSON.parse(raw) as Record<string, unknown>;
  return `postgres://${encodeURIComponent(String(db.username))}:${encodeURIComponent(String(db.password))}@${String(db.host)}:${String(db.port)}/${String(db.database)}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const databaseUrl = databaseUrlFrom(env);
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to start the worker");
  }
  const transport = env.EMAIL_TRANSPORT === "ses" ? "ses" : "smtp";
  return {
    databaseUrl,
    email: {
      transport,
      from: env.EMAIL_FROM ?? "no-reply@guidesk.local",
      smtpHost: env.SMTP_HOST ?? "localhost",
      smtpPort: Number(env.SMTP_PORT ?? 1025),
      sesConfigurationSet: env.SES_CONFIGURATION_SET,
    },
    integrations: loadIntegrationSettings(env, { production: env.NODE_ENV === "production" }),
  };
}
