import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

/** Development values for the feature 002 settings (T006). Test-only, never real secrets. */
const integrationBase = {
  LOCAL_KMS_KEY: Buffer.alloc(32, 7).toString("base64"),
  FEED_URL_PEPPER: "p".repeat(32),
};

describe("loadConfig", () => {
  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow("DATABASE_URL is required");
  });

  it("reads DATABASE_URL", () => {
    expect(
      loadConfig({ DATABASE_URL: "postgres://localhost/guidesk", ...integrationBase }),
    ).toMatchObject({
      databaseUrl: "postgres://localhost/guidesk",
      email: { transport: "smtp", smtpPort: 1025 },
    });
  });
});

describe("integration settings (T006)", () => {
  const env = { DATABASE_URL: "postgres://localhost/guidesk", ...integrationBase };

  it("uses local stand-ins outside production", () => {
    expect(loadConfig(env).integrations).toMatchObject({
      kms: { mode: "local" },
      sandbox: { mode: "in-process" },
      llm: { mode: "fake" },
      pms: { mode: "fixtures" },
    });
  });

  it("requires the model's API key with LLM_MODE=anthropic", () => {
    expect(() => loadConfig({ ...env, LLM_MODE: "anthropic" })).toThrow("ANTHROPIC_API_KEY");
  });

  it("requires the feed-link pepper", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgres://localhost/guidesk" })).toThrow(
      "FEED_URL_PEPPER",
    );
  });

  it("refuses local stand-ins and sandbox test settings in production (research R2)", () => {
    expect(() =>
      loadConfig({ ...env, NODE_ENV: "production", SANDBOX_TEST_ALLOW_HOST: "localhost" }),
    ).toThrow(
      /KMS_MODE=local[\s\S]*STORAGE_MODE=local[\s\S]*SANDBOX_MODE=in-process[\s\S]*LLM_MODE=fake[\s\S]*PMS_MODE=fixtures[\s\S]*SANDBOX_TEST_ALLOW_HOST/,
    );
  });
});
