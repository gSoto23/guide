import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publicMetadata } from "../lib/public/metadata";

/** Feature 015: the preview images, the Google mark, and the public pages' preview tags. */
const brand = path.join(__dirname, "../public/brand");

function pngSize(file: string): { width: number; height: number } {
  const data = readFileSync(file);
  expect(data.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe("brand assets (FR-016, FR-025)", () => {
  it.each(["es", "en"])("the %s preview image is 1200 × 630 and under 100 KB", (lang) => {
    const file = path.join(brand, `og-${lang}.png`);
    expect(pngSize(file)).toEqual({ width: 1200, height: 630 });
    expect(statSync(file).size).toBeLessThan(100 * 1024);
  });

  it("serves the Google mark from the portal", () => {
    expect(readFileSync(path.join(brand, "google-g.svg"), "utf8")).toMatch(/^<svg /);
  });
});

describe("public page previews (FR-024)", () => {
  it.each([
    ["es", ""],
    ["en", "/privacy"],
  ] as const)("%s%s carries the branded image and a large twitter card", (locale, page) => {
    const meta = publicMetadata(locale, page);
    const images = meta.openGraph?.images as { url: string; width: number }[];
    expect(images[0]?.url).toMatch(new RegExp(`/brand/og-${locale}\\.png$`));
    expect(images[0]?.width).toBe(1200);
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });
});
