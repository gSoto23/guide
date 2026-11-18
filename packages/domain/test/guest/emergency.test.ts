import { describe, expect, it } from "vitest";
import { emergencyNumberFor } from "../../src/guest/emergency.js";

describe("emergency numbers (feature 004 FR-007, research R18)", () => {
  it("knows the pilot countries", () => {
    expect(emergencyNumberFor("CR")).toBe("911");
    expect(emergencyNumberFor("CO")).toBe("123");
    expect(emergencyNumberFor("cr")).toBe("911");
  });

  it("returns null for unknown or missing countries", () => {
    expect(emergencyNumberFor("ZZ")).toBeNull();
    expect(emergencyNumberFor(null)).toBeNull();
  });
});
