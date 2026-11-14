import { describe, expect, it } from "vitest";
import { loadApiConfig } from "../../src/config/config.js";

const base = {
  DATABASE_URL: "postgres://u:p@localhost:5432/guidesk",
  BETTER_AUTH_SECRET: "x".repeat(32),
  PORTAL_URL: "http://localhost:3000",
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
