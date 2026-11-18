import { describe, expect, it } from "vitest";
import {
  encodePropertyLinkId,
  isPropertyLinkId,
  isStayToken,
  PROPERTY_LINK_BYTES,
  STAY_TOKEN_BYTES,
  encodeStayToken,
} from "../../src/guest/links.js";

describe("guest links (feature 004 research R4)", () => {
  it("encodes 17 random bytes as 26 lowercase base32 characters", () => {
    const id = encodePropertyLinkId(new Uint8Array(PROPERTY_LINK_BYTES).fill(255));
    expect(id).toMatch(/^[a-z2-7]{26}$/);
    expect(encodePropertyLinkId(new Uint8Array(PROPERTY_LINK_BYTES))).toBe("a".repeat(26));
  });

  it("refuses property links of the wrong length or alphabet", () => {
    expect(isPropertyLinkId("a".repeat(26))).toBe(true);
    expect(isPropertyLinkId("a".repeat(25))).toBe(false);
    expect(isPropertyLinkId("A".repeat(26))).toBe(false);
    expect(isPropertyLinkId(`${"a".repeat(25)}1`)).toBe(false);
    expect(() => encodePropertyLinkId(new Uint8Array(8))).toThrow();
  });

  it("encodes 32 random bytes as a 43-character base64url stay token", () => {
    const token = encodeStayToken(new Uint8Array(STAY_TOKEN_BYTES).fill(251));
    expect(token).toHaveLength(43);
    expect(isStayToken(token)).toBe(true);
    expect(isStayToken(`${token.slice(0, 42)}=`)).toBe(false);
    expect(isStayToken(token.slice(1))).toBe(false);
    expect(() => encodeStayToken(new Uint8Array(16))).toThrow();
  });
});
