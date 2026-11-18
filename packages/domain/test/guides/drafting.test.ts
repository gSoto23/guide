import { describe, expect, it } from "vitest";
import {
  docFromList,
  docFromPlainText,
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
