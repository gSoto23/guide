import { describe, expect, it } from "vitest";
import { ensureDeviceCookie, isValidDeviceId } from "../../src/auth/device-cookie.js";

const VALID = "A".repeat(43);

describe("ensureDeviceCookie (T058, T103 finding A5)", () => {
  it("keeps a valid device cookie", () => {
    const header = `a=1; guidesk.device=${VALID}`;
    expect(ensureDeviceCookie(header, true)).toEqual({ cookie: header });
  });

  it.each([
    ["missing", "a=1"],
    ["empty", "a=1; guidesk.device="],
    ["bare", "a=1; guidesk.device"],
    ["malformed", "a=1; guidesk.device=not-a-device-id"],
    ["duplicated", `guidesk.device=${VALID}; guidesk.device=${"B".repeat(43)}`],
  ])(
    "issues a new device ID when the cookie is %s, so the new-device alert can't be suppressed",
    (_, header) => {
      const result = ensureDeviceCookie(header, true);
      expect(result.setCookie).toMatch(
        /^guidesk\.device=[A-Za-z0-9_-]{43}; .*HttpOnly; SameSite=Lax; Secure$/,
      );
      const devices = result.cookie.split("; ").filter((part) => part.startsWith("guidesk.device"));
      expect(devices).toHaveLength(1);
      expect(isValidDeviceId(devices[0]?.slice("guidesk.device=".length))).toBe(true);
      expect(result.cookie).not.toContain("not-a-device-id");
    },
  );
});
