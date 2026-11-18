import type { ReactNode } from "react";

/**
 * Renders a guide document (feature 003 research R2) as React elements, never as raw HTML, so
 * nothing in content can run as a script (SEC-11, AC-SEC-008). The same renderer serves the
 * portal's preview and, in spec 004, the guest guide.
 *
 * The document types are structural, matching `@guidesk/contracts` `GuideDocument`, so this
 * package keeps no dependency on the contracts.
 */
type Mark = { type: "bold" } | { type: "italic" } | { type: "link"; attrs: { href: string } };
type Inline =
  | { type: "text"; text: string; marks?: Mark[] }
  | { type: "hardBreak" }
  | { type: "lockedField"; attrs: { fieldId: string } };
interface TextBlock {
  type: "paragraph" | "heading";
  attrs?: { level: 3 | 4 };
  content?: Inline[];
}
interface List {
  type: "bulletList" | "orderedList";
  attrs?: { start: number };
  content: { type: "listItem"; content: (TextBlock | List)[] }[];
}
export interface RenderableDocument {
  type: "doc";
  content: (TextBlock | List)[];
}

export interface GuideDocumentViewProps {
  doc: RenderableDocument | null | undefined;
  /** How a locked-field reference shows: the field's label, or its value where spec 004 allows it. */
  renderLockedField: (fieldId: string) => ReactNode;
  className?: string;
}

const SAFE_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"]);

function safeHref(href: string): string | null {
  try {
    return SAFE_PROTOCOLS.has(new URL(href).protocol) ? href : null;
  } catch {
    return null;
  }
}

function renderInline(
  node: Inline,
  key: number,
  lockedField: GuideDocumentViewProps["renderLockedField"],
): ReactNode {
  if (node.type === "hardBreak") return <br key={key} />;
  if (node.type === "lockedField") {
    return (
      <span key={key} className="locked-field-ref">
        {lockedField(node.attrs.fieldId)}
      </span>
    );
  }
  let element: ReactNode = node.text;
  const marks = node.marks ?? [];
  if (marks.some((mark) => mark.type === "italic")) element = <em>{element}</em>;
  if (marks.some((mark) => mark.type === "bold")) element = <strong>{element}</strong>;
  const link = marks.find((mark): mark is Extract<Mark, { type: "link" }> => mark.type === "link");
  const href = link ? safeHref(link.attrs.href) : null;
  if (href) {
    element = (
      <a href={href} rel="noopener noreferrer nofollow" target="_blank">
        {element}
      </a>
    );
  }
  return <span key={key}>{element}</span>;
}

function renderBlock(
  block: TextBlock | List,
  key: number,
  lockedField: GuideDocumentViewProps["renderLockedField"],
): ReactNode {
  const inline = (content: Inline[] | undefined) =>
    (content ?? []).map((node, index) => renderInline(node, index, lockedField));
  switch (block.type) {
    case "paragraph":
      return <p key={key}>{inline(block.content)}</p>;
    case "heading":
      return block.attrs?.level === 4 ? (
        <h4 key={key}>{inline(block.content)}</h4>
      ) : (
        <h3 key={key}>{inline(block.content)}</h3>
      );
    case "bulletList":
    case "orderedList": {
      const items = block.content.map((item, index) => (
        <li key={index}>
          {item.content.map((child, childIndex) => renderBlock(child, childIndex, lockedField))}
        </li>
      ));
      return block.type === "bulletList" ? (
        <ul key={key}>{items}</ul>
      ) : (
        <ol key={key} start={block.attrs?.start}>
          {items}
        </ol>
      );
    }
    default:
      return null;
  }
}

/** A guide document as React elements. Unknown nodes are skipped. */
export function GuideDocumentView({ doc, renderLockedField, className }: GuideDocumentViewProps) {
  if (!doc || doc.type !== "doc") return null;
  return (
    <div className={className ?? "guide-document"}>
      {doc.content.map((block, index) => renderBlock(block, index, renderLockedField))}
    </div>
  );
}
