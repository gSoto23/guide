import { describe, expect, it } from "vitest";
import { defaultWorkspaceName, WORKSPACE_NAME_MAX } from "../src/index.js";

describe("defaultWorkspaceName (FR-004)", () => {
  it("uses the creator's name in their language", () => {
    expect(defaultWorkspaceName("Ana", "es")).toBe("Espacio de Ana");
    expect(defaultWorkspaceName("Marco", "en")).toBe("Marco's workspace");
  });

  it("falls back when the name is empty", () => {
    expect(defaultWorkspaceName("  ", "es")).toBe("Mi espacio de trabajo");
    expect(defaultWorkspaceName(null, "en")).toBe("My workspace");
  });

  it("never exceeds the maximum length", () => {
    expect(defaultWorkspaceName("x".repeat(200), "es").length).toBeLessThanOrEqual(
      WORKSPACE_NAME_MAX,
    );
  });
});
