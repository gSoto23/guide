import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

/**
 * Settings for the feature 002 adapters, shared by the API and the worker (T006). Values come
 * from the environment; secrets (`ANTHROPIC_API_KEY`, `FEED_URL_PEPPER`) are injected from
 * Secrets Manager in AWS, never stored in the repository.
 *
 * Development and test may use local stand-ins for AWS services, a fake model, and recorded PMS
 * responses. Production refuses every one of them, and the sandbox test allowances (research
 * R2), so a misconfigured deploy fails at start-up instead of running with test doubles.
 */
export interface IntegrationSettings {
  kms: { mode: "aws"; keyId: string } | { mode: "local"; localKey: Buffer };
  storage: { mode: "s3"; bucket: string } | { mode: "local"; dir: string };
  sandbox:
    | { mode: "lambda"; feedReaderFunction: string; fileProcessorFunction: string }
    | { mode: "in-process"; testAllowHost?: string; testCaFile?: string };
  /** `none` for a service that never calls the model (the API: extraction runs in the worker). */
  llm: { mode: "anthropic"; apiKey: string } | { mode: "fake" } | { mode: "none" };
  pms: { mode: "live" | "fixtures" };
  /** Secret for calendar-link fingerprints (HMAC-SHA-256). */
  feedUrlPepper: string;
  flags: { pmsBeds24: boolean; pmsHostex: boolean; extractionScreenshots: boolean };
}

const flag = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((value) => value === "true" || value === "1");

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

const schema = z.object({
  KMS_MODE: z.enum(["aws", "local"]).default("local"),
  KMS_KEY_ID: optionalText,
  LOCAL_KMS_KEY: optionalText,
  STORAGE_MODE: z.enum(["s3", "local"]).default("local"),
  UPLOADS_BUCKET: optionalText,
  LOCAL_STORAGE_DIR: optionalText,
  SANDBOX_MODE: z.enum(["lambda", "in-process"]).default("in-process"),
  SANDBOX_FEED_READER_FUNCTION: optionalText,
  SANDBOX_FILE_PROCESSOR_FUNCTION: optionalText,
  SANDBOX_TEST_ALLOW_HOST: optionalText,
  SANDBOX_TEST_CA_FILE: optionalText,
  LLM_MODE: z.enum(["anthropic", "fake"]).default("fake"),
  ANTHROPIC_API_KEY: optionalText,
  PMS_MODE: z.enum(["live", "fixtures"]).default("fixtures"),
  FEED_URL_PEPPER: z
    .string({ error: "FEED_URL_PEPPER is required" })
    .min(32, "FEED_URL_PEPPER must be at least 32 characters"),
  PMS_BEDS24: flag,
  PMS_HOSTEX: flag,
  EXTRACTION_SCREENSHOTS: flag,
});

type Parsed = z.infer<typeof schema>;

export interface IntegrationSettingsOptions {
  /** True for every deployed stage (staging included), where `NODE_ENV=production`. */
  production: boolean;
  /** False for a service that never calls the model, so it never needs the API key. */
  usesLlm?: boolean;
}

/** Collects every problem at once, so one start-up shows the whole list. */
function problems(env: Parsed, production: boolean, usesLlm: boolean): string[] {
  const found: string[] = [];
  const require = (ok: boolean, message: string): void => {
    if (!ok) found.push(message);
  };

  if (env.KMS_MODE === "aws")
    require(Boolean(env.KMS_KEY_ID), "KMS_KEY_ID is required with KMS_MODE=aws");
  if (env.KMS_MODE === "local") {
    const key = env.LOCAL_KMS_KEY ? Buffer.from(env.LOCAL_KMS_KEY, "base64") : undefined;
    require(key?.length ===
      32, "LOCAL_KMS_KEY must be 32 bytes, base64-encoded, with KMS_MODE=local");
  }
  if (env.STORAGE_MODE === "s3") {
    require(Boolean(env.UPLOADS_BUCKET), "UPLOADS_BUCKET is required with STORAGE_MODE=s3");
  }
  if (env.SANDBOX_MODE === "lambda") {
    require(Boolean(
      env.SANDBOX_FEED_READER_FUNCTION && env.SANDBOX_FILE_PROCESSOR_FUNCTION,
    ), "SANDBOX_FEED_READER_FUNCTION and SANDBOX_FILE_PROCESSOR_FUNCTION are required with SANDBOX_MODE=lambda");
  }
  if (usesLlm && env.LLM_MODE === "anthropic") {
    require(Boolean(
      env.ANTHROPIC_API_KEY,
    ), "ANTHROPIC_API_KEY is required with LLM_MODE=anthropic");
  }

  if (production) {
    require(env.KMS_MODE !== "local", "KMS_MODE=local is not allowed in production (research R5)");
    require(env.STORAGE_MODE !== "local", "STORAGE_MODE=local is not allowed in production");
    require(env.SANDBOX_MODE !==
      "in-process", "SANDBOX_MODE=in-process is not allowed in production (research R2)");
    if (usesLlm) require(env.LLM_MODE !== "fake", "LLM_MODE=fake is not allowed in production");
    require(env.PMS_MODE !== "fixtures", "PMS_MODE=fixtures is not allowed in production");
    require(!env.SANDBOX_TEST_ALLOW_HOST &&
      !env.SANDBOX_TEST_CA_FILE, "SANDBOX_TEST_ALLOW_HOST and SANDBOX_TEST_CA_FILE are not allowed in production (research R2)");
  }
  return found;
}

/** Reads and checks the integration settings. */
export function loadIntegrationSettings(
  env: NodeJS.ProcessEnv,
  { production, usesLlm = true }: IntegrationSettingsOptions,
): IntegrationSettings {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid integration settings:\n${issues.join("\n")}`);
  }
  const parsed = result.data;
  const found = problems(parsed, production, usesLlm);
  if (found.length > 0) {
    throw new Error(`Invalid integration settings:\n${found.join("\n")}`);
  }

  return {
    kms:
      parsed.KMS_MODE === "aws"
        ? { mode: "aws", keyId: parsed.KMS_KEY_ID as string }
        : { mode: "local", localKey: Buffer.from(parsed.LOCAL_KMS_KEY as string, "base64") },
    storage:
      parsed.STORAGE_MODE === "s3"
        ? { mode: "s3", bucket: parsed.UPLOADS_BUCKET as string }
        : { mode: "local", dir: resolveLocalDir(parsed.LOCAL_STORAGE_DIR ?? ".uploads") },
    sandbox:
      parsed.SANDBOX_MODE === "lambda"
        ? {
            mode: "lambda",
            feedReaderFunction: parsed.SANDBOX_FEED_READER_FUNCTION as string,
            fileProcessorFunction: parsed.SANDBOX_FILE_PROCESSOR_FUNCTION as string,
          }
        : {
            mode: "in-process",
            ...(parsed.SANDBOX_TEST_ALLOW_HOST
              ? { testAllowHost: parsed.SANDBOX_TEST_ALLOW_HOST }
              : {}),
            ...(parsed.SANDBOX_TEST_CA_FILE ? { testCaFile: parsed.SANDBOX_TEST_CA_FILE } : {}),
          },
    llm: !usesLlm
      ? { mode: "none" }
      : parsed.LLM_MODE === "anthropic"
        ? { mode: "anthropic", apiKey: parsed.ANTHROPIC_API_KEY as string }
        : { mode: "fake" },
    pms: { mode: parsed.PMS_MODE },
    feedUrlPepper: parsed.FEED_URL_PEPPER,
    flags: {
      pmsBeds24: parsed.PMS_BEDS24,
      pmsHostex: parsed.PMS_HOSTEX,
      extractionScreenshots: parsed.EXTRACTION_SCREENSHOTS,
    },
  };
}

/**
 * A local folder setting as an absolute path. A relative one is read from the monorepo root (the
 * folder with `pnpm-workspace.yaml`), not from the working directory: the API and the worker run
 * in their own folders and must share the uploads folder. Outside the monorepo it is read from
 * `from`.
 */
export function resolveLocalDir(dir: string, from: string = process.cwd()): string {
  if (isAbsolute(dir)) return dir;
  let current = resolve(from);
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return resolve(current, dir);
    const parent = dirname(current);
    if (parent === current) return resolve(from, dir);
    current = parent;
  }
}
