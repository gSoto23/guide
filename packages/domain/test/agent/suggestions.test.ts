import { describe, expect, it } from "vitest";
import type { GuideSnapshot } from "../../src/guides/snapshot.js";
import { suggestionKeys } from "../../src/agent/suggestions.js";

describe("suggested questions (feature 005 FR-003)", () => {
  it("follows the guide's sections with content, at most four", () => {
    const section = (kind: string, items = 1) => ({
      id: kind,
      kind,
      items: Array.from({ length: items }, () => ({})),
    });
    const snapshot = {
      sections: [
        section("arrival"),
        section("wifi", 0),
        section("house_rules"),
        section("custom"),
        section("checkout"),
        section("parking"),
        section("appliances"),
      ],
    } as unknown as GuideSnapshot;
    expect(suggestionKeys(snapshot)).toEqual(["arrival", "house_rules", "checkout", "parking"]);
  });
});
