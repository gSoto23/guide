import type { SegDocument, SegInline, SegList, SegTextBlock } from "./segmenter.js";

/**
 * Building guide documents from the plain text the model returns (feature 003 research R6): the
 * model never returns markup, so drafted content is safe by construction.
 */
const BULLET = /^\s*[-•*]\s+/;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

function inline(line: string): SegInline[] {
  return line.length > 0 ? [{ type: "text", text: line }] : [];
}

/** Paragraphs split by blank lines; lines starting with "- " become a bulleted list. */
export function docFromPlainText(text: string): SegDocument {
  const content: SegDocument["content"] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);
    let paragraph: string[] = [];
    let bullets: string[] = [];
    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      const nodes: SegInline[] = [];
      paragraph.forEach((line, index) => {
        if (index > 0) nodes.push({ type: "hardBreak" });
        nodes.push(...inline(line.trim()));
      });
      content.push({ type: "paragraph", content: nodes });
      paragraph = [];
    };
    const flushBullets = () => {
      if (bullets.length === 0) return;
      content.push({
        type: "bulletList",
        content: bullets.map((item) => ({
          type: "listItem" as const,
          content: [{ type: "paragraph" as const, content: inline(item) }],
        })),
      });
      bullets = [];
    };
    for (const line of lines) {
      if (BULLET.test(line)) {
        flushParagraph();
        bullets.push(line.replace(BULLET, "").trim());
      } else {
        flushBullets();
        paragraph.push(line);
      }
    }
    flushParagraph();
    flushBullets();
  }
  return { type: "doc", content };
}

/** A bulleted list document, for amenities (research R16). */
export function docFromList(items: readonly string[]): SegDocument {
  const clean = items.map((item) => item.trim()).filter((item) => item.length > 0);
  if (clean.length === 0) return { type: "doc", content: [] };
  return {
    type: "doc",
    content: [
      {
        type: "bulletList",
        content: clean.map((item) => ({
          type: "listItem" as const,
          content: [{ type: "paragraph" as const, content: inline(item) }],
        })),
      },
    ],
  };
}

/** Removes addresses the model wrote that were not in its input (FR-027, AC-SEC-007). */
export function stripUnknownLinks(text: string, input: string): string {
  return text
    .replace(URL_IN_TEXT, (url) => (input.includes(url) ? url : ""))
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * Replaces the first occurrence of `value` in text block `blockIndex` with a locked-field
 * reference (FR-023 "Move to a locked field"). Returns null when the value is not there. The
 * value never stays in the text.
 */
export function replaceWithLockedField(
  doc: SegDocument,
  blockIndex: number,
  value: string,
  fieldId: string,
): SegDocument | null {
  const copy = structuredClone(doc);
  let index = -1;
  let replaced = false;
  const visit = (node: SegDocument["content"][number]): void => {
    if (replaced) return;
    if (node.type === "bulletList" || node.type === "orderedList") {
      const list = node as SegList;
      for (const item of list.content) for (const child of item.content) visit(child);
      return;
    }
    const block = node as SegTextBlock;
    index += 1;
    if (index !== blockIndex) return;
    {
      const content = block.content ?? [];
      for (let position = 0; position < content.length; position += 1) {
        const inlineNode = content[position];
        if (inlineNode?.type !== "text") continue;
        const at = inlineNode.text.indexOf(value);
        if (at === -1) continue;
        const before = inlineNode.text.slice(0, at);
        const after = inlineNode.text.slice(at + value.length);
        const marks = inlineNode.marks;
        const pieces: SegInline[] = [
          ...(before ? [{ type: "text" as const, text: before, ...(marks ? { marks } : {}) }] : []),
          { type: "lockedField", attrs: { fieldId } },
          ...(after ? [{ type: "text" as const, text: after, ...(marks ? { marks } : {}) }] : []),
        ];
        content.splice(position, 1, ...pieces);
        block.content = content;
        replaced = true;
        return;
      }
    }
  };
  for (const block of copy.content) visit(block);
  return replaced ? copy : null;
}
