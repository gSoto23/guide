import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadApiConfig } from "../../src/config/config.js";

/** Development values for the feature 002 settings (T006). Test-only, never real secrets. */
const integrationBase = {
  LOCAL_KMS_KEY: Buffer.alloc(32, 7).toString("base64"),
  FEED_URL_PEPPER: "p".repeat(32),
};

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/guidesk",
  BETTER_AUTH_SECRET: "x".repeat(32),
  PORTAL_URL: "http://localhost:3000",
  ...integrationBase,
};

/** A production configuration that passes every check, with AWS adapters. */
const production = {
  ...base,
  NODE_ENV: "production",
  PORTAL_URL: "https://app.example.test",
  EDGE_SHARED_SECRET: "e".repeat(32),
  KMS_MODE: "aws",
  KMS_KEY_ID: "arn:aws:kms:us-east-1:000000000000:key/test",
  LOCAL_KMS_KEY: "",
  STORAGE_MODE: "s3",
  UPLOADS_BUCKET: "guidesk-uploads-test",
  SANDBOX_MODE: "lambda",
  SANDBOX_FEED_READER_FUNCTION: "feed-reader",
  SANDBOX_FILE_PROCESSOR_FUNCTION: "file-processor",
  PMS_MODE: "live",
};

describe("loadApiConfig", () => {
  it("applies defaults for local development", () => {
    const config = loadApiConfig(base);
    expect(config.NODE_ENV).toBe("development");
    expect(config.EMAIL_TRANSPORT).toBe("smtp");
    expect(config.PORT).toBe(4000);
  });

  it("rejects a short auth secret", () => {
    expect(() => loadApiConfig({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow("at least 32");
  });

  it("requires the edge secret and HTTPS in production", () => {
    expect(() => loadApiConfig({ ...base, NODE_ENV: "production" })).toThrow(
      /EDGE_SHARED_SECRET[\s\S]*HTTPS/,
    );
  });

  it("builds DATABASE_URL and secrets from SST links", () => {
    const config = loadApiConfig({
      ...integrationBase,
      PORTAL_URL: "http://localhost:3000",
      SST_RESOURCE_Database: JSON.stringify({
        host: "db.internal",
        port: 5432,
        username: "postgres",
        password: "p@ss word",
        database: "guidesk",
      }),
      SST_RESOURCE_BetterAuthSecret: JSON.stringify({ value: "s".repeat(40) }),
    });
    expect(config.DATABASE_URL).toBe("postgres://postgres:p%40ss%20word@db.internal:5432/guidesk");
    expect(config.BETTER_AUTH_SECRET).toBe("s".repeat(40));
  });

  it("builds DATABASE_URL from separate variables with the password from Secrets Manager (T103)", () => {
    const config = loadApiConfig({
      ...integrationBase,
      BETTER_AUTH_SECRET: "x".repeat(32),
      PORTAL_URL: "http://localhost:3000",
      DATABASE_HOST: "db.internal",
      DATABASE_PORT: "5432",
      DATABASE_NAME: "guidesk",
      DATABASE_USER: "guidesk",
      DATABASE_PASSWORD: "p@ss/word",
      DATABASE_SSLMODE: "no-verify",
    });
    expect(config.DATABASE_URL).toBe(
      "postgres://guidesk:p%40ss%2Fword@db.internal:5432/guidesk?sslmode=no-verify",
    );
  });
});

describe("integration settings (T006)", () => {
  it("uses local stand-ins, the fake model, and PMS fixtures by default in development", () => {
    const { integrations } = loadApiConfig(base);
    expect(integrations).toMatchObject({
      kms: { mode: "local" },
      // A relative folder is read from the monorepo root, so the API and the worker share it.
      storage: { mode: "local", dir: resolve(import.meta.dirname, "../../../../.uploads") },
      sandbox: { mode: "in-process" },
      llm: { mode: "none" },
      pms: { mode: "fixtures" },
      flags: { pmsBeds24: false, pmsHostex: false, extractionScreenshots: false },
    });
    expect(integrations.kms.mode === "local" && integrations.kms.localKey.length).toBe(32);
  });

  it("requires a feed-link pepper of at least 32 characters", () => {
    expect(() => loadApiConfig({ ...base, FEED_URL_PEPPER: "short" })).toThrow(
      "FEED_URL_PEPPER must be at least 32 characters",
    );
    const { FEED_URL_PEPPER: _omitted, ...withoutPepper } = base;
    expect(() => loadApiConfig(withoutPepper)).toThrow("FEED_URL_PEPPER");
  });

  it("requires a 32-byte local key with KMS_MODE=local", () => {
    expect(() =>
      loadApiConfig({ ...base, LOCAL_KMS_KEY: Buffer.alloc(16).toString("base64") }),
    ).toThrow("LOCAL_KMS_KEY must be 32 bytes");
  });

  it("requires the settings each AWS mode needs", () => {
    expect(() =>
      loadApiConfig({ ...base, KMS_MODE: "aws", STORAGE_MODE: "s3", SANDBOX_MODE: "lambda" }),
    ).toThrow(/KMS_KEY_ID[\s\S]*UPLOADS_BUCKET[\s\S]*SANDBOX_FEED_READER_FUNCTION/);
  });

  it("never needs the model's API key, because extraction runs in the worker", () => {
    expect(loadApiConfig(production).integrations.llm).toEqual({ mode: "none" });
    // Even a model setting that production refuses for the worker is ignored by the API.
    expect(loadApiConfig({ ...production, LLM_MODE: "fake" }).integrations.llm).toEqual({
      mode: "none",
    });
  });

  it("reads feature flags", () => {
    const { integrations } = loadApiConfig({
      ...base,
      PMS_BEDS24: "true",
      PMS_HOSTEX: "1",
      EXTRACTION_SCREENSHOTS: "false",
    });
    expect(integrations.flags).toEqual({
      pmsBeds24: true,
      pmsHostex: true,
      extractionScreenshots: false,
    });
  });

  it("accepts a production configuration with AWS adapters", () => {
    const { integrations } = loadApiConfig(production);
    expect(integrations).toMatchObject({
      kms: { mode: "aws" },
      storage: { mode: "s3", bucket: "guidesk-uploads-test" },
      sandbox: { mode: "lambda" },
      llm: { mode: "none" },
      pms: { mode: "live" },
    });
  });

  it.each([
    ["KMS_MODE", { KMS_MODE: "local", LOCAL_KMS_KEY: integrationBase.LOCAL_KMS_KEY }],
    ["STORAGE_MODE", { STORAGE_MODE: "local" }],
    ["SANDBOX_MODE", { SANDBOX_MODE: "in-process" }],
    ["PMS_MODE", { PMS_MODE: "fixtures" }],
    ["SANDBOX_TEST_ALLOW_HOST", { SANDBOX_TEST_ALLOW_HOST: "localhost" }],
    ["SANDBOX_TEST_CA_FILE", { SANDBOX_TEST_CA_FILE: "/tmp/ca.pem" }],
  ])("refuses %s test settings in production (research R2)", (name, override) => {
    expect(() => loadApiConfig({ ...production, ...override })).toThrow(
      new RegExp(`${name}[^\n]*not allowed in production`),
    );
  });
});
