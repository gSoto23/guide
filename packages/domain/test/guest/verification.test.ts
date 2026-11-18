import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_ALPHABET,
  CONFIRMATION_LENGTH,
  codeFromBytes,
  lockoutMinutes,
  nextLockoutCount,
  normalizeConfirmationCode,
  VERIFICATION_MAX_FAILURES,
} from "../../src/guest/verification.js";

describe("confirmation codes (feature 004 FR-034, research R4)", () => {
  it("uses 31 symbols without look-alike characters", () => {
    expect(CONFIRMATION_ALPHABET).toHaveLength(31);
    for (const confusing of ["0", "1", "I", "L", "O"]) {
      expect(CONFIRMATION_ALPHABET).not.toContain(confusing);
    }
  });

  it("maps random bytes to 6 symbols from the alphabet", () => {
    const code = codeFromBytes(new Uint8Array([0, 1, 30, 31, 62, 255, 7, 9]));
    expect(code).toHaveLength(CONFIRMATION_LENGTH);
    for (const char of code) expect(CONFIRMATION_ALPHABET).toContain(char);
  });

  it("rejects biased bytes instead of wrapping them", () => {
    // 248 and above would bias the modulo; they are skipped.
    const code = codeFromBytes(new Uint8Array([255, 250, 248, 0, 1, 2, 3, 4, 5]));
    expect(code).toBe([0, 1, 2, 3, 4, 5].map((index) => CONFIRMATION_ALPHABET[index]).join(""));
    expect(() => codeFromBytes(new Uint8Array([255, 255, 0]))).toThrow();
  });

  it("ignores case and spaces when comparing", () => {
    expect(normalizeConfirmationCode(" ab 2c-d3 ")).toBe("AB2C-D3");
    expect(normalizeConfirmationCode("ab2 cd3")).toBe("AB2CD3");
  });
});

describe("lockout backoff (FR-035, research R8)", () => {
  it("locks after 5 failures for 15 minutes, doubling up to 24 hours", () => {
    expect(VERIFICATION_MAX_FAILURES).toBe(5);
    expect(lockoutMinutes(1)).toBe(15);
    expect(lockoutMinutes(2)).toBe(30);
    expect(lockoutMinutes(3)).toBe(60);
    expect(lockoutMinutes(7)).toBe(960);
    expect(lockoutMinutes(8)).toBe(1440);
    expect(lockoutMinutes(20)).toBe(1440);
  });

  it("resets the lockout count after 24 hours without a lockout", () => {
    const now = new Date("2026-12-13T12:00:00Z");
    expect(nextLockoutCount(0, null, now)).toBe(1);
    expect(nextLockoutCount(2, new Date("2026-12-13T08:00:00Z"), now)).toBe(3);
    expect(nextLockoutCount(4, new Date("2026-12-12T11:59:59Z"), now)).toBe(1);
  });
});
