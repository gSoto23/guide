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

/** The longest merged draft piece; content past it stays in a separate item (feature 021 FR-007). */
export const MERGED_PIECE_MAX = 4000;

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function sameText(text: string): string {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Joins drafted pieces that share their main topic (and group, such as the section) into one
 * piece, so one answer or one part of a listing does not become several small items (feature 021
 * FR-007). Pieces keep the order they first appear in, repeated paragraphs are dropped, pieces
 * without a topic stay apart, and a join that would pass MERGED_PIECE_MAX starts a new piece.
 */
export function mergeDraftPieces<T extends { text: string; topics: readonly string[] }>(
  pieces: readonly T[],
  groupOf: (piece: T) => string = () => "",
): T[] {
  const merged: T[] = [];
  const openIndex = new Map<string, number>();
  for (const piece of pieces) {
    const topic = piece.topics[0];
    if (!topic) {
      merged.push(piece);
      continue;
    }
    const key = `${groupOf(piece)}\u0000${topic}`;
    const index = openIndex.get(key);
    const current = index === undefined ? undefined : merged[index];
    if (index !== undefined && current) {
      const topics = [...new Set([...current.topics, ...piece.topics])];
      const known = new Set(paragraphsOf(current.text).map(sameText));
      const added = paragraphsOf(piece.text).filter((paragraph) => !known.has(sameText(paragraph)));
      const text = [current.text, ...added].join("\n\n");
      if (text.length <= MERGED_PIECE_MAX) {
        merged[index] = { ...current, text, topics };
        continue;
      }
    }
    openIndex.set(key, merged.length);
    merged.push(piece);
  }
  return merged;
}
