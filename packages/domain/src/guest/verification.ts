/**
 * Optional confirmation codes and their brute-force limits (feature 004 FR-033 to FR-035,
 * research R4 and R8, SEC-03). Comparison in constant time happens in the API with Node's
 * `timingSafeEqual` on the normalized values.
 */

/** No 0, 1, I, L, or O, which guests confuse on a phone. */
export const CONFIRMATION_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CONFIRMATION_LENGTH = 6;
/** Failures allowed in a window before the stay locks, per device, per address, and per stay. */
export const VERIFICATION_MAX_FAILURES = 5;
export const VERIFICATION_WINDOW_MINUTES = 15;
const FIRST_LOCKOUT_MINUTES = 15;
const MAX_LOCKOUT_MINUTES = 24 * 60;
const LOCKOUT_RESET_MS = 24 * 60 * 60 * 1000;

/** The largest multiple of the alphabet size below 256: bytes above it are skipped (no bias). */
const UNBIASED_LIMIT =
  Math.floor(256 / CONFIRMATION_ALPHABET.length) * CONFIRMATION_ALPHABET.length;

/** A code from random bytes (pass at least 16, so rejected bytes rarely run out). */
export function codeFromBytes(bytes: Uint8Array): string {
  let code = "";
  for (const byte of bytes) {
    if (byte >= UNBIASED_LIMIT) continue;
    code += CONFIRMATION_ALPHABET[byte % CONFIRMATION_ALPHABET.length];
    if (code.length === CONFIRMATION_LENGTH) return code;
  }
  throw new Error("Not enough random bytes for a confirmation code");
}

/** Case and spaces are ignored (spec edge case). */
export function normalizeConfirmationCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

/** 15 minutes for the first lockout, doubling for each later one, up to 24 hours. */
export function lockoutMinutes(lockoutNumber: number): number {
  const exponent = Math.max(0, lockoutNumber - 1);
  return Math.min(MAX_LOCKOUT_MINUTES, FIRST_LOCKOUT_MINUTES * 2 ** exponent);
}

/** The number of the lockout about to start; the count resets after 24 hours without one. */
export function nextLockoutCount(current: number, lastLockoutAt: Date | null, now: Date): number {
  if (!lastLockoutAt || now.getTime() - lastLockoutAt.getTime() >= LOCKOUT_RESET_MS) return 1;
  return current + 1;
}
