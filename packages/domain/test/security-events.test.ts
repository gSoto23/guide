import { describe, expect, it } from "vitest";
import { assertSafeMetadata, SECURITY_EVENT_TYPES } from "../src/index.js";

describe("security event catalog", () => {
  it("has unique event types", () => {
    expect(new Set(SECURITY_EVENT_TYPES).size).toBe(SECURITY_EVENT_TYPES.length);
  });

  it("rejects metadata keys that look like secrets", () => {
    expect(() => assertSafeMetadata({ otpCode: "123456" })).toThrow("must not contain secrets");
    expect(() => assertSafeMetadata({ sessionToken: "x" })).toThrow();
    expect(() => assertSafeMetadata({ oldRole: "agent", newRole: "admin" })).not.toThrow();
  });
});
