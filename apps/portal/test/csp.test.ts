import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, mediaOriginOf } from "../lib/csp";

/** Feature 016 (research R5): the portal allows photos from the stage's media origin. */
describe("portal content security policy", () => {
  it("adds the media origin to images and media", () => {
    const csp = contentSecurityPolicy("n", false, true, "https://media.example.com");
    expect(csp).toContain("img-src 'self' data: blob: https://media.example.com");
    expect(csp).toContain("media-src 'self' blob: https://media.example.com");
  });

  it("keeps images same-origin without a media origin", () => {
    expect(contentSecurityPolicy("n", false)).toContain("img-src 'self' data: blob:;");
  });

  it.each([
    ["https://bucket.s3.amazonaws.com/path", "https://bucket.s3.amazonaws.com"],
    ["http://insecure.example.com", null],
    ["not a url", null],
    [undefined, null],
  ])("reads %s as %s", (value, expected) => {
    expect(mediaOriginOf(value)).toBe(expected);
  });
});
