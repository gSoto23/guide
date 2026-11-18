import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  GuideDocumentView,
  type RenderableDocument,
} from "../src/guide-renderer/guide-document.js";

/** The guide renderer (feature 003 T044, research R2, AC-SEC-008). */
const FIELD = "3f0c9a52-8a43-4c1e-9d6e-2b7f1c0a9e11";

function render(doc: RenderableDocument): string {
  return renderToStaticMarkup(
    <GuideDocumentView doc={doc} renderLockedField={() => "[Lockbox code]"} />,
  );
}

describe("GuideDocumentView", () => {
  it("renders every node and mark as elements", () => {
    const html = render({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Llegada" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Código ", marks: [{ type: "bold" }] },
            { type: "lockedField", attrs: { fieldId: FIELD } },
            { type: "hardBreak" },
            {
              type: "text",
              text: "mapa",
              marks: [
                { type: "italic" },
                { type: "link", attrs: { href: "https://example.com/mapa" } },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 2 },
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Paso" }] }],
            },
          ],
        },
      ],
    });
    expect(html).toContain("<h3>");
    expect(html).toContain("<strong>Código </strong>");
    expect(html).toContain('<span class="locked-field-ref">[Lockbox code]</span>');
    expect(html).toContain("<br/>");
    expect(html).toContain(
      '<a href="https://example.com/mapa" rel="noopener noreferrer nofollow" target="_blank"><em>mapa</em></a>',
    );
    expect(html).toContain('<ol start="2"><li><p>');
  });

  it("escapes text and never renders raw HTML or unsafe links", () => {
    const html = render({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "<img src=x onerror=alert(1)>" },
            {
              type: "text",
              text: "clic",
              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
            },
          ],
        },
      ],
    });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
  });

  it("skips unknown nodes and renders nothing for an empty value", () => {
    expect(render({ type: "doc", content: [{ type: "script" } as never] })).toBe(
      '<div class="guide-document"></div>',
    );
    expect(
      renderToStaticMarkup(<GuideDocumentView doc={null} renderLockedField={() => null} />),
    ).toBe("");
  });
});
