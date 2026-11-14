import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("requires DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow("DATABASE_URL is required");
  });

  it("reads DATABASE_URL", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://localhost/guidesk" })).toMatchObject({
      databaseUrl: "postgres://localhost/guidesk",
      email: { transport: "smtp", smtpPort: 1025 },
    });
  });
});
