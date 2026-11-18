import { describe, expect, it } from "vitest";
import {
  computeCompleteness,
  type CoverageInput,
  type CoverageSection,
} from "../../src/guides/completeness.js";
import { DEFAULT_SECTION_KINDS } from "../../src/guides/template.js";

/** Coverage and the completeness score (feature 003 FR-030 to FR-033, research R10, T011). */
function sections(
  overrides: Partial<Record<string, Partial<CoverageSection>>> = {},
): CoverageSection[] {
  return DEFAULT_SECTION_KINDS.map((kind) => ({
    kind,
    hidden: false,
    items: [],
    ...overrides[kind],
  }));
}

const text = (value: string, topics: string[] = []) => ({
  kind: "text" as const,
  texts: [value],
  topics,
});

function input(partial: Partial<CoverageInput>): CoverageInput {
  return { sections: sections(), setLockedFieldKinds: [], facts: {}, marks: {}, ...partial };
}

describe("computeCompleteness", () => {
  it("scores an empty guide at 0% with every topic missing, heaviest first", () => {
    const result = computeCompleteness(input({}));
    expect(result.guide).toBe(0);
    expect(result.missing[0]?.weight).toBe(5);
    expect(result.missing.map((topic) => topic.weight)).toEqual(
      [...result.missing.map((topic) => topic.weight)].sort((a, b) => b - a),
    );
  });

  it("matches keywords in either language, ignoring case and accents", () => {
    const result = computeCompleteness(
      input({
        sections: sections({
          appliances: { items: [text("El AIRE ACONDICIONADO se enciende con el control.")] },
          parking: {
            items: [
              { kind: "text", texts: ["Parqueo frente a la casa", "Parking in front"], topics: [] },
            ],
          },
          emergency: { items: [text("En caso de emergencia llamá al 911. Clínica a 5 km.")] },
        }),
      }),
    );
    expect(result.sections.appliances?.topics["appliances.ac_heating"]).toBe("covered");
    expect(result.sections.parking?.topics["parking.where"]).toBe("covered");
    expect(result.sections.emergency?.topics["emergency.number"]).toBe("covered");
    expect(result.sections.emergency?.topics["emergency.medical"]).toBe("covered");
  });

  it("does not match a keyword inside another word", () => {
    const result = computeCompleteness(
      input({ sections: sections({ wifi: { items: [text("Credenciales en la tarjeta")] } }) }),
    );
    expect(result.sections.wifi?.topics["wifi.network"]).toBe("missing");
  });

  it("applies locked-field, media, recommendation, personal-tip, and fact rules", () => {
    const result = computeCompleteness(
      input({
        setLockedFieldKinds: ["lockbox_code", "wifi_password"],
        facts: { check_in_time: true, checkout_time: true },
        sections: sections({
          arrival: { items: [{ kind: "image", texts: [], topics: [] }] },
          local_recommendations: {
            items: [
              { kind: "recommendation", texts: ["Soda Tapia"], topics: [] },
              { kind: "recommendation", texts: ["Super Sámara"], topics: [] },
              { kind: "recommendation", texts: ["Playa Carrillo"], topics: [], personalTip: true },
            ],
          },
        }),
      }),
    );
    expect(result.sections.arrival?.topics).toMatchObject({
      "arrival.access_code": "covered",
      "arrival.access_photo": "covered",
      "arrival.check_in_time": "covered",
    });
    expect(result.sections.wifi?.topics["wifi.password"]).toBe("covered");
    expect(result.sections.local_recommendations?.topics).toMatchObject({
      "local.recommendations": "covered",
      "local.personal_tip": "covered",
    });
    expect(result.sections.checkout?.topics["checkout.time"]).toBe("covered");
  });

  it("counts AI topic tags as coverage", () => {
    const result = computeCompleteness(
      input({
        sections: sections({
          appliances: { items: [text("Se usa así.", ["appliances.laundry"])] },
        }),
      }),
    );
    expect(result.sections.appliances?.topics["appliances.laundry"]).toBe("covered");
  });

  it("lets host marks win, and leaves 'Doesn't apply' out of the score (FR-032)", () => {
    const base = computeCompleteness(input({}));
    const marked = computeCompleteness(
      input({
        marks: {
          "parking.where": "not_applicable",
          "parking.transport": "not_applicable",
          "wifi.troubleshooting": "covered",
        },
      }),
    );
    expect(marked.sections.parking?.score).toBe(100);
    expect(marked.sections.wifi?.topics["wifi.troubleshooting"]).toBe("covered");
    expect(marked.missing.some((topic) => topic.topicId === "parking.where")).toBe(false);
    expect(marked.guide).toBeGreaterThan(base.guide);
  });

  it("leaves hidden and custom sections out", () => {
    const hidden = computeCompleteness(
      input({
        sections: [
          ...sections({ parking: { hidden: true } }),
          { kind: "custom", hidden: false, items: [text("Piscina")] },
        ],
      }),
    );
    expect(hidden.sections.parking).toBeUndefined();
    expect(hidden.missing.some((topic) => topic.sectionKind === "parking")).toBe(false);
  });

  it("counts inherited shared-block items like the section's own", () => {
    const result = computeCompleteness(
      input({
        sections: sections({
          checkout: { items: [text("Deja las llaves en la mesa y saca la basura.")] },
        }),
      }),
    );
    expect(result.sections.checkout?.topics["checkout.steps"]).toBe("covered");
  });

  it("reaches 100% when everything is covered", () => {
    const marks = Object.fromEntries(
      computeCompleteness(input({})).missing.map((topic) => [topic.topicId, "covered" as const]),
    );
    expect(computeCompleteness(input({ marks })).guide).toBe(100);
  });
});
