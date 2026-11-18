import { describe, expect, it } from "vitest";
import {
  DEFAULT_FACT_ITEMS,
  DEFAULT_SECTION_KINDS,
  mainLanguage,
  sectionStatus,
} from "../../src/guides/template.js";
import {
  ESSENTIAL_TOPICS,
  GUIDE_TOPICS,
  isGuideTopicId,
  validTopicIds,
} from "../../src/guides/topics.js";

/** The guide template and key topics (feature 003 FR-001, FR-013, FR-029, T010). */
describe("guide template", () => {
  it("has the nine default sections in order (FR-001)", () => {
    expect(DEFAULT_SECTION_KINDS).toEqual([
      "arrival",
      "wifi",
      "house_rules",
      "appliances",
      "amenities",
      "parking",
      "local_recommendations",
      "emergency",
      "checkout",
    ]);
  });

  it("starts every guide with the four live facts (FR-006)", () => {
    expect(DEFAULT_FACT_ITEMS.map((item) => `${item.sectionKind}:${item.factKey}`)).toEqual([
      "arrival:check_in_time",
      "arrival:address",
      "house_rules:max_guests",
      "checkout:checkout_time",
    ]);
  });

  it("derives a section's status from its items (FR-013)", () => {
    expect(sectionStatus([{ kind: "fact", reviewed: true }])).toBe("missing");
    expect(sectionStatus([{ kind: "text", reviewed: false }])).toBe("needs_review");
    expect(sectionStatus([{ kind: "text", reviewed: true, hasOutOfDateTranslation: true }])).toBe(
      "needs_review",
    );
    expect(
      sectionStatus([
        { kind: "fact", reviewed: true },
        { kind: "image", reviewed: true },
      ]),
    ).toBe("ready");
  });

  it("takes the first guide language as the main language (FR-003)", () => {
    expect(mainLanguage(["en", "es"])).toBe("en");
    expect(() => mainLanguage([])).toThrow();
  });
});

describe("key topics (FR-029)", () => {
  it("gives every topic a valid section, a weight from 1 to 5, and at least one rule", () => {
    for (const topic of GUIDE_TOPICS) {
      expect(DEFAULT_SECTION_KINDS, topic.id).toContain(topic.section);
      expect(topic.weight, topic.id).toBeGreaterThanOrEqual(1);
      expect(topic.weight, topic.id).toBeLessThanOrEqual(5);
      expect(topic.rules.length, topic.id).toBeGreaterThan(0);
    }
  });

  it("has unique IDs and topics in every default section", () => {
    expect(new Set(GUIDE_TOPICS.map((topic) => topic.id)).size).toBe(GUIDE_TOPICS.length);
    for (const kind of DEFAULT_SECTION_KINDS) {
      expect(
        GUIDE_TOPICS.some((topic) => topic.section === kind),
        kind,
      ).toBe(true);
    }
    expect(GUIDE_TOPICS.length).toBeGreaterThanOrEqual(30);
  });

  it("covers what imports usually miss: appliance how-tos, personal tips, and access photos", () => {
    const ids = GUIDE_TOPICS.map((topic) => topic.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "appliances.ac_heating",
        "local.personal_tip",
        "arrival.access_photo",
      ]),
    );
  });

  it("names essentials that exist", () => {
    for (const id of ESSENTIAL_TOPICS) expect(isGuideTopicId(id)).toBe(true);
  });

  it("marks code topics for the locked-field form (FR-038)", () => {
    const codeTopics = GUIDE_TOPICS.filter((topic) => topic.lockedFieldKind).map(
      (topic) => topic.id,
    );
    expect(codeTopics).toEqual(["arrival.access_code", "wifi.password"]);
  });

  it("keeps only known topic IDs from AI tags", () => {
    expect(validTopicIds(["wifi.password", "made.up", "wifi.password"])).toEqual(["wifi.password"]);
  });
});
