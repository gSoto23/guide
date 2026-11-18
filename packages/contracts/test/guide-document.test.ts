import { describe, expect, it } from "vitest";
import {
  documentLinks,
  documentLockedFieldIds,
  documentPlainText,
  documentTextLength,
  guideDocumentSchema,
  parseGuideDocument,
  sharedBlockDocumentSchema,
  type GuideDocument,
} from "../src/guide-document.js";

/**
 * The content document schema (feature 003 research R2, T008, AC-SEC-008): only the allowed
 * nodes, marks, attributes, and link schemes are stored; anything else is refused with a path.
 */
const FIELD_ID = "3f0c9a52-8a43-4c1e-9d6e-2b7f1c0a9e11";

const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", content });

const valid = doc(
  { type: "heading", attrs: { level: 3 }, content: [text("Llegada")] },
  paragraph(
    text("La caja está a la izquierda; el código es "),
    { type: "lockedField", attrs: { fieldId: FIELD_ID } },
    text("."),
    { type: "hardBreak" },
    text("Más info", [
      { type: "bold" },
      { type: "link", attrs: { href: "https://example.com/llegada" } },
    ]),
  ),
  {
    type: "bulletList",
    content: [
      { type: "listItem", content: [paragraph(text("Abre el portón", [{ type: "italic" }]))] },
      {
        type: "listItem",
        content: [
          paragraph(text("Llama si necesitas ayuda")),
          {
            type: "orderedList",
            attrs: { start: 1 },
            content: [
              {
                type: "listItem",
                content: [
                  paragraph(
                    text("Teléfono", [{ type: "link", attrs: { href: "tel:+50688880000" } }]),
                  ),
                ],
              },
            ],
          },
        ],
      },
    ],
  },
);

function refusedPath(input: unknown): string | undefined {
  const result = parseGuideDocument(input);
  return result.ok ? undefined : result.path;
}

describe("guide document schema", () => {
  it("accepts every allowed node and mark", () => {
    const result = parseGuideDocument(valid);
    expect(result.ok).toBe(true);
    expect(guideDocumentSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an empty document and links by email", () => {
    expect(parseGuideDocument(doc()).ok).toBe(true);
    expect(
      parseGuideDocument(
        doc(
          paragraph(
            text("Escríbenos", [{ type: "link", attrs: { href: "mailto:hola@example.com" } }]),
          ),
        ),
      ).ok,
    ).toBe(true);
  });

  it.each([
    ["a script node", doc({ type: "script", content: [text("alert(1)")] }), "content.0.type"],
    ["a raw HTML string", "<p onclick=alert(1)>Hola</p>", ""],
    [
      "an image node",
      doc({ type: "image", attrs: { src: "https://example.com/x.png" } }),
      "content.0.type",
    ],
    [
      "a level-1 heading",
      doc({ type: "heading", attrs: { level: 1 }, content: [text("Título")] }),
      "content.0.attrs.level",
    ],
    [
      "a javascript: link",
      doc(paragraph(text("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))),
      "content.0.content.0.marks.0.attrs.href",
    ],
    [
      "a data: link",
      doc(paragraph(text("x", [{ type: "link", attrs: { href: "data:text/html,<b>x</b>" } }]))),
      "content.0.content.0.marks.0.attrs.href",
    ],
    [
      "an unknown mark",
      doc(paragraph(text("x", [{ type: "highlight" }]))),
      "content.0.content.0.marks.0.type",
    ],
    [
      "an extra attribute",
      doc({ type: "paragraph", attrs: { onclick: "alert(1)" }, content: [text("x")] }),
      "content.0.attrs",
    ],
    ["an empty text node", doc(paragraph(text(""))), "content.0.content.0.text"],
    ["a list without items", doc({ type: "bulletList", content: [] }), "content.0.content"],
    [
      "a locked field with a bad ID",
      doc(paragraph({ type: "lockedField", attrs: { fieldId: "4821" } })),
      "content.0.content.0.attrs.fieldId",
    ],
  ])("refuses %s with a path", (_name, input, path) => {
    expect(refusedPath(input)).toBe(path);
    expect(guideDocumentSchema.safeParse(input).success).toBe(false);
  });

  it("refuses lists nested more than three levels deep", () => {
    let list: unknown = paragraph(text("hoja"));
    for (let depth = 0; depth < 5; depth += 1) {
      list = {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph(text("nivel")), list] }],
      };
    }
    expect(parseGuideDocument(doc(list)).ok).toBe(false);
  });

  it("refuses more than 20,000 characters", () => {
    expect(parseGuideDocument(doc(paragraph(text("a".repeat(20_001))))).ok).toBe(false);
  });

  it("refuses locked fields in shared blocks (FR-057)", () => {
    expect(sharedBlockDocumentSchema.safeParse(valid).success).toBe(false);
    expect(parseGuideDocument(valid, { allowLockedFields: false })).toMatchObject({
      ok: false,
      path: "content.1.content.1.type",
    });
  });

  it("drops the editor's own link attributes when they hold their defaults", () => {
    const fromEditor = doc(
      paragraph(
        text("x", [
          {
            type: "link",
            attrs: {
              href: "https://example.com",
              target: "_blank",
              rel: "noopener noreferrer nofollow",
              class: null,
            },
          },
        ]),
      ),
    );
    const result = parseGuideDocument(fromEditor);
    expect(result.ok && result.doc).toEqual(
      doc(paragraph(text("x", [{ type: "link", attrs: { href: "https://example.com/" } }]))),
    );
  });
});

describe("plain-text helpers", () => {
  const parsed = parseGuideDocument(valid);
  const document = (parsed.ok ? parsed.doc : doc()) as GuideDocument;

  it("joins blocks with new lines and shows locked fields as a marker", () => {
    expect(documentPlainText(document)).toBe(
      "Llegada\nLa caja está a la izquierda; el código es [locked].\nMás info\nAbre el portón\nLlama si necesitas ayuda\nTeléfono",
    );
  });

  it("counts characters without markers", () => {
    expect(documentTextLength(document)).toBe(
      "Llegada".length +
        "La caja está a la izquierda; el código es .".length +
        "Más info".length +
        "Abre el portón".length +
        "Llama si necesitas ayuda".length +
        "Teléfono".length,
    );
  });

  it("lists locked fields and links", () => {
    expect(documentLockedFieldIds(document)).toEqual([FIELD_ID]);
    expect(documentLinks(document)).toEqual(["https://example.com/llegada", "tel:+50688880000"]);
  });
});
