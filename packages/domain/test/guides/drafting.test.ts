import { describe, expect, it } from "vitest";
import { docFromList, docFromPlainText, stripUnknownLinks } from "../../src/guides/drafting.js";

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
