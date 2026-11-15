import { describe, expect, it } from "vitest";
import { derivePath, PMS_OPTIONS, PROPERTIES_BUCKETS, validateOnboarding } from "../src/index.js";

describe("derivePath (T030, FR-006)", () => {
  it("routes 10+ properties to the manager path, with or without a PMS", () => {
    expect(derivePath({ propertiesBucket: "10_plus", pms: null })).toBe("manager");
    expect(derivePath({ propertiesBucket: "10_plus", pms: "none" })).toBe("manager");
  });

  it("routes 3–10 properties with a PMS to the manager path", () => {
    expect(derivePath({ propertiesBucket: "3_10", pms: "hostaway" })).toBe("manager");
    expect(derivePath({ propertiesBucket: "3_10", pms: "other" })).toBe("manager");
  });

  it("routes 3–10 properties without a PMS, 1–2 properties, and skipped answers to the individual path", () => {
    expect(derivePath({ propertiesBucket: "3_10", pms: "none" })).toBe("individual");
    expect(derivePath({ propertiesBucket: "3_10", pms: null })).toBe("individual");
    expect(derivePath({ propertiesBucket: "1_2", pms: "hospitable" })).toBe("individual");
    expect(derivePath({ propertiesBucket: null, pms: null })).toBe("individual");
  });

  it("offers exactly the documented answers", () => {
    expect(PROPERTIES_BUCKETS).toEqual(["1_2", "3_10", "10_plus"]);
    expect(PMS_OPTIONS).toContain("none");
    expect(PMS_OPTIONS).toContain("other");
  });
});

describe("validateOnboarding (FR-005)", () => {
  it("accepts all answers skipped", () => {
    expect(
      validateOnboarding({ propertiesBucket: null, pms: null, pmsOther: null, country: null }),
    ).toEqual([]);
  });

  it("requires pmsOther only when pms is other, at most 80 characters", () => {
    expect(
      validateOnboarding({ propertiesBucket: null, pms: "other", pmsOther: null, country: null }),
    ).toContain("pmsOther is required when pms is other");
    expect(
      validateOnboarding({ propertiesBucket: null, pms: "hostaway", pmsOther: "x", country: null }),
    ).toContain("pmsOther is only allowed when pms is other");
    expect(
      validateOnboarding({
        propertiesBucket: null,
        pms: "other",
        pmsOther: "x".repeat(81),
        country: null,
      }),
    ).toContain("pmsOther must be at most 80 characters");
  });

  it("requires an ISO 3166-1 alpha-2 country code", () => {
    expect(
      validateOnboarding({ propertiesBucket: null, pms: null, pmsOther: null, country: "CR" }),
    ).toEqual([]);
    expect(
      validateOnboarding({
        propertiesBucket: null,
        pms: null,
        pmsOther: null,
        country: "Costa Rica",
      }),
    ).toContain("country must be an ISO 3166-1 alpha-2 code");
  });
});
