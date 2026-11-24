import { describe, expect, it } from "vitest";
import { asksOffPlatform } from "../../src/guides/publish-checks.js";
import {
  documentText,
  lockedFieldPlaceholder,
  scheduledMessageTemplate,
  stayMessage,
} from "../../src/guest/messages.js";

const link = "https://guide.example.com/g/aaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("scheduled-message template (feature 004 FR-038)", () => {
  for (const language of ["es", "en"] as const) {
    it(`includes the property link and nothing else to unlock codes (${language})`, () => {
      const text = scheduledMessageTemplate(language, {
        propertyName: "Casa Colibrí",
        propertyLink: link,
      });
      expect(text).toContain(link);
      expect(text).toContain("Casa Colibrí");
      expect(text).not.toMatch(/\/s\//);
      expect(asksOffPlatform(text)).toBe(false);
    });
  }
});

describe("stay message (feature 004 FR-039, FR-040)", () => {
  const base = {
    propertyName: "Casa Colibrí",
    stayLink: "https://guide.example.com/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    checkInDate: "2026-12-12",
    checkoutDate: "2026-12-15",
    checkInTime: "15:00",
    checkoutTime: "11:00",
    address: "Calle Ficticia 123, Sámara",
    arrival: `Abre la caja con ${lockedFieldPlaceholder("Caja de llaves", "es")}.`,
    wifi: "Red: CasaColibri",
    confirmationCode: null,
  };

  it("carries the essentials, the stay link, and the optional-guide reminder in Spanish", () => {
    const text = stayMessage("es", base);
    expect(text).toContain(base.stayLink);
    expect(text).toContain("15:00");
    expect(text).toContain("11:00");
    expect(text).toContain(base.address);
    expect(text).toContain("Caja de llaves (lo ves en tu enlace de estadía)");
    expect(text).toContain("Red: CasaColibri");
    expect(text).toMatch(/opcional/);
    expect(text).not.toMatch(/Código de confirmación/);
    expect(asksOffPlatform(text)).toBe(false);
  });

  it("adds the confirmation code and works in English", () => {
    const text = stayMessage("en", {
      ...base,
      arrival: "Open the lockbox with 2704.",
      confirmationCode: "K7M2QX",
    });
    expect(text).toContain("Confirmation code to show the access codes: K7M2QX");
    expect(text).toContain("Open the lockbox with 2704.");
    expect(text).toMatch(/optional/);
    expect(asksOffPlatform(text)).toBe(false);
  });

  it("skips missing parts", () => {
    const text = stayMessage("en", { ...base, address: null, arrival: null, wifi: null });
    expect(text).not.toContain("Address:");
    expect(text).not.toContain("Getting in");
    expect(text).not.toContain("Wi-Fi:");
  });
});

describe("stay message greeting (feature 018 FR-021)", () => {
  const base = {
    propertyName: "Casa Colibrí",
    stayLink: "https://guide.example.com/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    checkInDate: "2026-12-12",
    checkoutDate: "2026-12-15",
    checkInTime: "15:00",
    checkoutTime: "11:00",
    address: null,
    arrival: null,
    wifi: null,
    confirmationCode: null,
  };

  it("greets the guest by the name the host saved, and generally otherwise", () => {
    expect(stayMessage("es", { ...base, guestName: "Ana" })).toMatch(/^¡Hola, Ana! Todo listo/);
    expect(stayMessage("en", { ...base, guestName: " Ana " })).toMatch(
      /^Hi Ana! Everything is ready/,
    );
    expect(stayMessage("es", { ...base, guestName: null })).toMatch(/^¡Hola! Todo listo/);
    expect(stayMessage("en", base)).toMatch(/^Hi! Everything is ready/);
  });
});

describe("documentText (feature 004 FR-039)", () => {
  it("turns a document into lines, with locked fields resolved", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Llegada" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Caja: " },
            { type: "lockedField", attrs: { fieldId: "f1" } },
            { type: "hardBreak" },
            { type: "text", text: "Portón azul" },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Abre" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Entra" }] }],
            },
          ],
        },
      ],
    };
    expect(documentText(doc, (id) => (id === "f1" ? "2704" : "?"))).toBe(
      "Llegada\nCaja: 2704\nPortón azul\n1. Abre\n2. Entra",
    );
    expect(documentText(null, () => "")).toBe("");
  });
});
