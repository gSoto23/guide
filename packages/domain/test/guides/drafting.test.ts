import { describe, expect, it } from "vitest";
import {
  docFromList,
  docFromPlainText,
  MERGED_PIECE_MAX,
  mergeDraftPieces,
  replaceWithLockedField,
  stripUnknownLinks,
} from "../../src/guides/drafting.js";

/** Documents from model text (feature 003 research R6). */
describe("drafting helpers", () => {
  it("builds paragraphs, hard breaks, and bulleted lists", () => {
    expect(docFromPlainText("Bienvenidos.\nPasen.\n\n- Toallas\n- Jabón\nGracias")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Bienvenidos." },
            { type: "hardBreak" },
            { type: "text", text: "Pasen." },
          ],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Toallas" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Jabón" }] }],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Gracias" }] },
      ],
    });
  });

  it("builds an amenities list and skips empty items", () => {
    expect(docFromList(["Wi-Fi", " ", "Piscina"]).content[0]).toMatchObject({ type: "bulletList" });
    expect(docFromList([])).toEqual({ type: "doc", content: [] });
  });

  it("keeps only links that were in the input", () => {
    expect(
      stripUnknownLinks(
        "Mapa: https://maps.example/casa y https://evil.example/x",
        "ver https://maps.example/casa",
      ),
    ).toBe("Mapa: https://maps.example/casa y ");
  });
});

describe("replaceWithLockedField (FR-023)", () => {
  const FIELD = "3f0c9a52-8a43-4c1e-9d6e-2b7f1c0a9e11";

  it("swaps the value for a reference in the right block and keeps the rest", () => {
    const doc = docFromPlainText("Bienvenidos.\n\nEl código de la puerta es 4821, gracias.");
    const result = replaceWithLockedField(doc, 1, "4821", FIELD);
    expect(result?.content[1]).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "El código de la puerta es " },
        { type: "lockedField", attrs: { fieldId: FIELD } },
        { type: "text", text: ", gracias." },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("4821");
  });

  it("returns null when the value is not in that block", () => {
    const doc = docFromPlainText("El código es 4821.");
    expect(replaceWithLockedField(doc, 0, "9999", FIELD)).toBeNull();
    expect(replaceWithLockedField(doc, 3, "4821", FIELD)).toBeNull();
  });
});

/** Feature 021 FR-007: one topic in one section becomes one drafted item. */
describe("mergeDraftPieces", () => {
  it("joins pieces on the same main topic and keeps their order", () => {
    const merged = mergeDraftPieces([
      { text: "Check-in desde las 15:00.", topics: ["arrival.check_in_time"] },
      { text: "Wi-Fi: CasaBrisa_5G.", topics: ["stay.wifi"] },
      {
        text: "Llega por la calle principal.",
        topics: ["arrival.check_in_time", "arrival.directions"],
      },
    ]);
    expect(merged).toEqual([
      {
        text: "Check-in desde las 15:00.\n\nLlega por la calle principal.",
        topics: ["arrival.check_in_time", "arrival.directions"],
      },
      { text: "Wi-Fi: CasaBrisa_5G.", topics: ["stay.wifi"] },
    ]);
  });

  it("keeps groups apart, drops repeated paragraphs, and leaves untagged pieces alone", () => {
    const merged = mergeDraftPieces(
      [
        { section: "arrival", text: "Portón azul.", topics: ["arrival.directions"] },
        { section: "arrival", text: "portón   AZUL.", topics: ["arrival.directions"] },
        { section: "area", text: "Portón azul.", topics: ["arrival.directions"] },
        { section: "area", text: "Sin tema.", topics: [] },
        { section: "area", text: "Otro sin tema.", topics: [] },
      ],
      (piece) => piece.section,
    );
    expect(merged.map((piece) => [piece.section, piece.text])).toEqual([
      ["arrival", "Portón azul."],
      ["area", "Portón azul."],
      ["area", "Sin tema."],
      ["area", "Otro sin tema."],
    ]);
  });

  it("starts a new piece when the join would be too long", () => {
    const long = "a".repeat(MERGED_PIECE_MAX - 10);
    const merged = mergeDraftPieces([
      { text: long, topics: ["stay.rules"] },
      { text: "Silencio después de las 22:00.", topics: ["stay.rules"] },
      { text: "No fumar.", topics: ["stay.rules"] },
    ]);
    expect(merged.map((piece) => piece.text)).toEqual([
      long,
      "Silencio después de las 22:00.\n\nNo fumar.",
    ]);
  });
});
