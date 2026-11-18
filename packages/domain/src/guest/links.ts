/**
 * Guest link formats (feature 004 research R4, SEC-01, SEC-02). Randomness comes from the caller
 * (the API uses `crypto.randomBytes`), so these functions stay pure and testable.
 */

/** 17 random bytes; the first 130 bits become the 26-character property link. */
export const PROPERTY_LINK_BYTES = 17;
export const PROPERTY_LINK_LENGTH = 26;
/** 32 random bytes (256 bits), as for invitation tokens (feature 001). */
export const STAY_TOKEN_BYTES = 32;
export const STAY_TOKEN_LENGTH = 43;

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const PROPERTY_LINK_PATTERN = /^[a-z2-7]{26}$/;
const STAY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Lowercase base32 (RFC 4648 alphabet) of the first 130 bits: short QR codes, easy to read. */
export function encodePropertyLinkId(bytes: Uint8Array): string {
  if (bytes.length < PROPERTY_LINK_BYTES) {
    throw new Error(`A property link needs ${PROPERTY_LINK_BYTES} random bytes`);
  }
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < PROPERTY_LINK_LENGTH) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length === PROPERTY_LINK_LENGTH) break;
  }
  return out;
}

/** Base64url without padding: 32 bytes become 43 characters. */
export function encodeStayToken(bytes: Uint8Array): string {
  if (bytes.length !== STAY_TOKEN_BYTES) {
    throw new Error(`A stay token needs exactly ${STAY_TOKEN_BYTES} random bytes`);
  }
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const chunk = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64URL[(chunk >>> 18) & 63];
    out += BASE64URL[(chunk >>> 12) & 63];
    if (b !== undefined) out += BASE64URL[(chunk >>> 6) & 63];
    if (c !== undefined) out += BASE64URL[chunk & 63];
  }
  return out;
}

/** Checked before any database lookup, so malformed values never reach a query. */
export function isPropertyLinkId(value: string): boolean {
  return PROPERTY_LINK_PATTERN.test(value);
}

export function isStayToken(value: string): boolean {
  return STAY_TOKEN_PATTERN.test(value);
}
