import { describe, expect, it } from "vitest";
import {
  copilotCodeDraft,
  copilotEmergencyDraft,
  cautionFor,
  removeContactDetails,
  withoutBenefitRecommendations,
} from "../../src/agent/index.js";
import type { GuideSnapshot } from "../../src/guides/snapshot.js";

describe("contact removal for inquiries (feature 006 PC-05)", () => {
  it("removes links, email addresses, and phone numbers, and says which", () => {
    expect(
      removeContactDetails(
        "Puedes ver fotos en https://casacolibri.example.com/fotos o escribir a ana@example.com.",
      ),
    ).toEqual({ text: "Puedes ver fotos en o escribir a", removed: ["link", "email"] });
    expect(removeContactDetails("Visit www.example.com, or call +506 8888 1234 anytime.")).toEqual({
      text: "Visit or call anytime.",
      removed: ["link", "phone"],
    });
    expect(removeContactDetails("Our site is casacolibri.com!").removed).toEqual(["link"]);
  });

  it("keeps times, prices of the guide, and ordinary text", () => {
    const text = "Check-in is 15:00 to 22:00; breakfast 7.30-10.30. Pets are welcome.";
    expect(removeContactDetails(text)).toEqual({ text, removed: [] });
  });

  it("runs in linear time on long hostile input", () => {
    const hostile = `${"!".repeat(50_000)} ${"1 ".repeat(20_000)}x`;
    const started = performance.now();
    removeContactDetails(hostile);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("copilot knowledge (feature 006 PC-10)", () => {
  it("drops recommendations that declare a benefit and keeps the rest", () => {
    const snapshot = {
      schema: 1,
      languages: ["es"],
      sections: [
        {
          id: "s1",
          kind: "local_recommendations",
          items: [
            {
              id: "a",
              kind: "recommendation",
              recommendation: {
                name: "Soda",
                category: "restaurant",
                benefit: "commission",
                personalTip: false,
              },
              texts: {},
              sourceLanguage: "es",
            },
            {
              id: "b",
              kind: "recommendation",
              recommendation: {
                name: "Playa",
                category: "beach",
                benefit: "none",
                personalTip: true,
              },
              texts: {},
              sourceLanguage: "es",
            },
            { id: "c", kind: "text", texts: {}, sourceLanguage: "es" },
          ],
        },
      ],
    } as unknown as GuideSnapshot;
    expect(
      withoutBenefitRecommendations(snapshot).sections[0]!.items.map((item) => item.id),
    ).toEqual(["b", "c"]);
  });
});

describe("copilot fixed drafts (feature 006 FR-013)", () => {
  it("maps escalations to cautions", () => {
    expect(cautionFor("none")).toBeNull();
    expect(cautionFor("sensitive_request")).toBe("codes");
    expect(cautionFor("money")).toBe("money");
  });

  it("writes emergency and code drafts as the host, never with a code", () => {
    expect(copilotEmergencyDraft("es", "911")).toContain("llama ya al 911");
    expect(copilotEmergencyDraft("es", "911", "formal")).toContain("llame ya al 911");
    expect(copilotEmergencyDraft("en", null)).toContain("local emergency number");
    expect(copilotCodeDraft("en", "inquiry", "Arrival")).toBe(
      "Access details are shared once the booking is confirmed.",
    );
    expect(copilotCodeDraft("es", "confirmed", "Llegada y acceso")).toContain("«Llegada y acceso»");
    expect(copilotCodeDraft("es", "confirmed", null, "formal")).toContain("Encontrará");
  });
});
