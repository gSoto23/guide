import { describe, expect, it } from "vitest";
import type { GuideSnapshot } from "../../src/guides/snapshot.js";
import { emergencyText, lockedPlaceholder, renderKnowledge } from "../../src/agent/knowledge.js";

const doc = (...content: object[]) => ({ type: "doc", content: [{ type: "paragraph", content }] });

const snapshot = {
  schema: 1,
  languages: ["es", "en"],
  sections: [
    {
      id: "s-arrival",
      kind: "arrival",
      items: [
        {
          id: "i1",
          kind: "text",
          sourceLanguage: "es",
          texts: {
            es: doc(
              { type: "text", text: "Abre la caja con " },
              { type: "lockedField", attrs: { fieldId: "f1" } },
            ),
            en: doc(
              { type: "text", text: "Open the lockbox with " },
              { type: "lockedField", attrs: { fieldId: "f1" } },
            ),
          },
        },
        { id: "i2", kind: "fact", factKey: "check_in_time", sourceLanguage: "es", texts: {} },
      ],
    },
    {
      id: "s-wifi",
      kind: "wifi",
      items: [
        {
          id: "i3",
          kind: "text",
          sourceLanguage: "es",
          texts: {
            es: doc(
              { type: "text", text: "Clave: " },
              { type: "lockedField", attrs: { fieldId: "f2" } },
            ),
          },
        },
      ],
    },
    {
      id: "s-tips",
      kind: "local_recommendations",
      items: [
        {
          id: "i4",
          kind: "recommendation",
          sourceLanguage: "es",
          texts: {},
          recommendation: {
            name: "Soda La Palma",
            category: "restaurant",
            url: "https://example.com/soda",
            benefit: "commission",
            personalTip: false,
          },
        },
      ],
    },
    { id: "s-empty", kind: "parking", items: [] },
    {
      id: "s-emergency",
      kind: "emergency",
      items: [
        {
          id: "i5",
          kind: "text",
          sourceLanguage: "en",
          texts: { en: doc({ type: "text", text: "Clinic: Calle 2, open 24 hours." }) },
        },
      ],
    },
  ],
} as unknown as GuideSnapshot;

const input = {
  snapshot,
  language: "en" as const,
  propertyName: "Casa Colibrí",
  facts: { checkInTime: "15:00", checkoutTime: "11:00", maxGuests: 4, address: "Calle Ficticia 1" },
  lockedLabels: new Map([["f1", "Lockbox code"]]),
  publicValues: new Map([["f2", "PalmeraAzul77"]]),
  sectionTitle: (kind: string) => kind.toUpperCase(),
  emergencyNumber: "911",
};

describe("knowledge renderer (feature 005 research R4)", () => {
  it("renders facts and sections with IDs, locked fields as labels, and public values", () => {
    const knowledge = renderKnowledge(input);
    expect(knowledge.text).toContain("Check-in: from 15:00");
    expect(knowledge.text).toContain("Local emergency number: 911");
    expect(knowledge.text).toContain("[section s-arrival] ARRIVAL");
    expect(knowledge.text).toContain(`Open the lockbox with ${lockedPlaceholder("Lockbox code")}`);
    expect(knowledge.text).toContain("Clave: PalmeraAzul77");
    expect(knowledge.text).toContain("disclosure: the host may receive a commission");
    expect(knowledge.text).not.toContain("s-empty");
    expect(knowledge.sections.map((section) => section.id)).toEqual([
      "s-arrival",
      "s-wifi",
      "s-tips",
      "s-emergency",
    ]);
  });

  it("is deterministic and falls back to the source language", () => {
    expect(renderKnowledge(input).text).toBe(renderKnowledge(input).text);
    expect(renderKnowledge({ ...input, language: "es" }).text).toContain("Abre la caja con");
    expect(emergencyText(input)).toBe("Clinic: Calle 2, open 24 hours.");
  });
});
