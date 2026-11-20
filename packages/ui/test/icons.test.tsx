import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Icon } from "../src/icons/icon.js";
import {
  ICONS,
  REASON_ICONS,
  SECTION_ICONS,
  reasonIcon,
  sectionIcon,
} from "../src/icons/registry.js";

/** The icon set (feature 015 T002, contract icons-illustrations, spec FR-013 to FR-015). */
const CONTRACT_NAMES = [
  "door",
  "wifi",
  "rules",
  "appliance",
  "amenity",
  "car",
  "pin",
  "emergency",
  "checkout",
  "gift",
  "compass",
  "bookmark",
  "inbox",
  "bag",
  "house",
  "chart",
  "layers",
  "people",
  "sliders",
  "more",
  "wrench",
  "frown",
  "coin",
  "calendar",
  "scale",
  "question",
  "pencil",
  "shield",
  "gauge",
  "cloudOff",
  "person",
  "plus",
  "message",
  "copy",
  "key",
  "chat",
  "phone",
  "globe",
  "chevron",
  "external",
  "check",
  "clock",
  "lock",
  "link",
  "qr",
  "camera",
];

const SECTION_KINDS = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
  "custom",
];

const REASONS = [
  "emergency",
  "malfunction",
  "complaint",
  "money",
  "reservation_change",
  "legal",
  "not_confident",
  "draft_ready",
  "check_failed",
  "limit",
  "monthly_limit",
  "unavailable",
  "taken_over",
];

describe("icon set", () => {
  it("has every icon named in the contract", () => {
    expect(Object.keys(ICONS).sort()).toEqual([...CONTRACT_NAMES].sort());
  });

  it.each(Object.entries(ICONS))("%s renders a hidden, currentColor icon", (_name, data) => {
    const html = renderToStaticMarkup(<Icon data={data} />);
    expect(html).toMatch(/^<svg [^>]*aria-hidden="true"/);
    expect(html).toContain('focusable="false"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('viewBox="0 0 24 24"');
    // No color besides none and currentColor, and nothing outside the 24 px grid.
    const colors = [...html.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(colors)).toEqual(new Set(["none", "currentColor"]));
    expect(html).not.toContain("style=");
    expect(data.length).toBeGreaterThan(0);
  });

  it("maps every guide section kind, Extras, and Explore", () => {
    for (const kind of SECTION_KINDS) expect(SECTION_ICONS).toHaveProperty(kind);
    expect(SECTION_ICONS.extras).toBe("gift");
    expect(SECTION_ICONS.explore).toBe("compass");
    expect(sectionIcon("not-a-kind")).toBe(ICONS.bookmark);
  });

  it("maps every needs-host reason", () => {
    for (const reason of REASONS) expect(REASON_ICONS).toHaveProperty(reason);
    expect(reasonIcon("emergency")).toBe(ICONS.emergency);
    expect(reasonIcon("unknown")).toBe(ICONS.question);
  });

  it("uses the requested size and class", () => {
    const html = renderToStaticMarkup(<Icon data={ICONS.wifi} size={16} className="tile-icon" />);
    expect(html).toContain('width="16"');
    expect(html).toContain('class="icon tile-icon"');
  });
});
