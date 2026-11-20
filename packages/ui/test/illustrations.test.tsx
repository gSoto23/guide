import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ILLUSTRATION_CLASSES } from "../src/illustrations/data.js";
import { ILLUSTRATIONS } from "../src/illustrations/registry.js";
import { BrandMark, Illustration } from "../src/illustrations/illustration.js";

/** The illustrations (feature 015 T003, contract icons-illustrations, spec FR-017, FR-018). */
const NAMES = [
  "door",
  "welcome",
  "noProperties",
  "inboxClear",
  "noRequests",
  "noData",
  "offline",
  "unavailable",
  "wait",
];

describe("illustrations", () => {
  it("has the nine illustrations of the contract", () => {
    expect(Object.keys(ILLUSTRATIONS).sort()).toEqual([...NAMES].sort());
  });

  it.each(NAMES)("%s is decorative, sized, and colored only by classes", (name) => {
    const html = renderToStaticMarkup(
      <Illustration data={ILLUSTRATIONS[name as keyof typeof ILLUSTRATIONS]} width={180} />,
    );
    expect(html).toMatch(/^<svg [^>]*aria-hidden="true"/);
    expect(html).toContain('width="180"');
    expect(html).toContain('height="120"');
    expect(html).not.toMatch(/<text|style=|fill="#|stroke="#|gradient|<image/i);
    const classes = [...html.matchAll(/class="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((value) => value !== "illustration");
    expect(classes.length).toBeGreaterThan(3);
    for (const value of classes) expect(ILLUSTRATION_CLASSES).toContain(value);
  });

  it("draws the brand mark with the brand classes", () => {
    const html = renderToStaticMarkup(<BrandMark size={20} />);
    expect(html).toContain('width="20"');
    expect(html).toContain('class="il-terra"');
    expect(html).toContain('class="il-sol"');
    expect(html).toContain('aria-hidden="true"');
  });
});
