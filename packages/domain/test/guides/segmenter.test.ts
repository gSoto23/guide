import { describe, expect, it } from "vitest";
import {
  rebuildDocument,
  segmentDocument,
  tokensMatch,
  type SegDocument,
} from "../../src/guides/segmenter.js";

/** The translation segmenter (feature 003 research R7, FR-047, T012). */
const FIELD = "3f0c9a52-8a43-4c1e-9d6e-2b7f1c0a9e11";

const doc: SegDocument = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Llegada" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "La caja está a la izquierda; el código es " },
        { type: "lockedField", attrs: { fieldId: FIELD } },
        { type: "text", text: ". " },
        { type: "text", text: "Importante", marks: [{ type: "bold" }] },
        { type: "hardBreak" },
        {
          type: "text",
          text: "Mapa",
          marks: [
            { type: "italic" },
            { type: "link", attrs: { href: "https://example.com/mapa" } },
          ],
        },
        { type: "text", text: " & 2 < 3" },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Abre el portón" }] }],
        },
      ],
    },
    { type: "paragraph" },
  ],
};

describe("segmentDocument", () => {
  it("turns each text block into one string with tags", () => {
    const result = segmentDocument(doc);
    expect(result.segments).toEqual([
      "Llegada",
      "La caja está a la izquierda; el código es <f1/>. <b>Importante</b><br/><a1><i>Mapa</i></a1> &amp; 2 &lt; 3",
      "Abre el portón",
      "",
    ]);
    expect(result.links).toEqual(["https://example.com/mapa"]);
    expect(result.fields).toEqual([FIELD]);
  });
});

describe("rebuildDocument", () => {
  it("rebuilds the same structure with translated text", () => {
    const result = rebuildDocument(doc, [
      "Arrival",
      "The box is on the left; the code is <f1/>. <b>Important</b><br/><a1><i>Map</i></a1> &amp; 2 &lt; 3",
      "Open the gate",
      "",
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const paragraph = result.doc.content[1];
    expect(paragraph).toEqual({
      type: "paragraph",
      content: [
        { type: "text", text: "The box is on the left; the code is " },
        { type: "lockedField", attrs: { fieldId: FIELD } },
        { type: "text", text: ". " },
        { type: "text", text: "Important", marks: [{ type: "bold" }] },
        { type: "hardBreak" },
        {
          type: "text",
          text: "Map",
          marks: [
            { type: "italic" },
            { type: "link", attrs: { href: "https://example.com/mapa" } },
          ],
        },
        { type: "text", text: " & 2 < 3" },
      ],
    });
    expect(result.doc.content[2]).toEqual({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Open the gate" }] }],
        },
      ],
    });
    expect(result.doc.content[3]).toEqual({ type: "paragraph" });
  });

  it.each([
    ["a missing locked field", "The code is ."],
    [
      "a duplicated locked field",
      "The code is <f1/> <f1/>. <b>Important</b><br/><a1><i>Map</i></a1> &amp; 2 &lt; 3",
    ],
    [
      "an invented link",
      "The code is <f1/>. <b>Important</b><br/><a2><i>Map</i></a2> &amp; 2 &lt; 3",
    ],
    ["crossed tags", "The code is <f1/>. <b>Important<br/><a1><i>Map</b></i></a1> &amp; 2 &lt; 3"],
  ])("refuses %s", (_name, second) => {
    const result = rebuildDocument(doc, ["Arrival", second, "Open the gate", ""]);
    expect(result).toEqual({ ok: false, failedSegments: [1] });
  });

  it("refuses a missing segment", () => {
    expect(rebuildDocument(doc, ["Arrival"]).ok).toBe(false);
  });
});

describe("tokensMatch", () => {
  it("compares tags and masked-code placeholders, in any order", () => {
    expect(
      tokensMatch("Código {{R1}} y <b>clave</b> {{R2}}", "<b>Password</b> {{R2}} and code {{R1}}"),
    ).toBe(true);
    expect(tokensMatch("Código {{R1}}", "Code")).toBe(false);
    expect(tokensMatch("Código {{R1}}", "Code {{R1}} {{R3}}")).toBe(false);
  });
});
