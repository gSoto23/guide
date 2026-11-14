import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { HealthController } from "../../src/health/health.controller.js";

describe("HealthController", () => {
  it("reports ok", () => {
    expect(new HealthController().check()).toEqual({ status: "ok" });
  });
});
