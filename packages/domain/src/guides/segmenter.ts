/**
 * The translation segmenter (feature 003 research R7). Each text block of a document (paragraph or
 * heading) becomes one string with inline tags the model must keep:
 *
 * - `<b>…</b>` bold, `<i>…</i>` italic, `<a1>…</a1>` the first link (addresses stay with Guidesk);
 * - `<f1/>` the first locked-field reference (it never holds a value), `<br/>` a hard break;
 * - `&lt;`, `&gt;`, and `&amp;` for those characters in the text.
 *
 * Masked codes (`{{R1}}`, research R5) are added after segmentation by the caller and survive as
 * plain text. After the call, `rebuildDocument` parses the strings back into the same structure
 * and refuses any string whose tags or placeholders do not match its source.
 *
 * The document types are structural copies of `@guidesk/contracts` `GuideDocument`, so the domain
 * keeps no package dependency.
 */
export type SegMark =
  { type: "bold" } | { type: "italic" } | { type: "link"; attrs: { href: string } };
export type SegInline =
  | { type: "text"; text: string; marks?: SegMark[] }
  | { type: "hardBreak" }
  | { type: "lockedField"; attrs: { fieldId: string } };
interface SegTextBlock {
  type: "paragraph" | "heading";
  attrs?: { level: 3 | 4 };
  content?: SegInline[];
}
interface SegList {
  type: "bulletList" | "orderedList";
  attrs?: { start: number };
  content: { type: "listItem"; content: (SegTextBlock | SegList)[] }[];
}
export interface SegDocument {
  type: "doc";
  content: (SegTextBlock | SegList)[];
}

export interface Segmentation {
  /** One string per text block, in reading order; empty blocks give "". */
  segments: string[];
  /** Link addresses by number: `<a1>` is `links[0]`. */
  links: string[];
  /** Locked-field IDs by number: `<f1/>` is `fields[0]`. */
  fields: string[];
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeText(text: string): string {
  return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function textBlocks(doc: SegDocument): SegTextBlock[] {
  const blocks: SegTextBlock[] = [];
  const visit = (node: SegTextBlock | SegList): void => {
    if (node.type === "paragraph" || node.type === "heading") {
      blocks.push(node);
      return;
    }
    const list = node as SegList;
    for (const item of list.content) for (const child of item.content) visit(child);
  };
  for (const block of doc.content) visit(block);
  return blocks;
}

/** Splits a document into strings for the model. */
export function segmentDocument(doc: SegDocument): Segmentation {
  const links: string[] = [];
  const fields: string[] = [];
  const segments = textBlocks(doc).map((block) =>
    (block.content ?? [])
      .map((inline) => {
        if (inline.type === "hardBreak") return "<br/>";
        if (inline.type === "lockedField") {
          fields.push(inline.attrs.fieldId);
          return `<f${fields.length}/>`;
        }
        let out = escapeText(inline.text);
        const marks = inline.marks ?? [];
        if (marks.some((mark) => mark.type === "italic")) out = `<i>${out}</i>`;
        if (marks.some((mark) => mark.type === "bold")) out = `<b>${out}</b>`;
        const link = marks.find(
          (mark): mark is Extract<SegMark, { type: "link" }> => mark.type === "link",
        );
        if (link) {
          links.push(link.attrs.href);
          out = `<a${links.length}>${out}</a${links.length}>`;
        }
        return out;
      })
      .join(""),
  );
  return { segments, links, fields };
}

const TAG = /<(\/?)(b|i|a(\d{1,3})|br\/|f(\d{1,3})\/)>/g;
const PLACEHOLDER = /\{\{R\d{1,4}\}\}/g;

/** The tags and placeholders of a string, sorted, to compare a translation with its source. */
function signature(segment: string): string {
  const tags = [...segment.matchAll(TAG)].map((match) => match[0]);
  const placeholders = segment.match(PLACEHOLDER) ?? [];
  return [...tags, ...placeholders].sort().join("");
}

/** True when a translated string keeps exactly the tags and placeholders of its source. */
export function tokensMatch(source: string, translated: string): boolean {
  return signature(source) === signature(translated);
}

type ParseOutcome = { ok: true; content: SegInline[] } | { ok: false };

/** Parses one translated string back into inline nodes. */
function parseSegment(segment: string, segmentation: Segmentation): ParseOutcome {
  const content: SegInline[] = [];
  const open: string[] = [];
  let cursor = 0;
  const pushText = (raw: string): boolean => {
    if (raw.length === 0) return true;
    if (/[<>]/.test(raw)) return false;
    const text = unescapeText(raw);
    const marks: SegMark[] = [];
    let linkHref: string | undefined;
    for (const tag of open) {
      if (tag === "b") marks.push({ type: "bold" });
      else if (tag === "i") marks.push({ type: "italic" });
      else {
        linkHref = segmentation.links[Number(tag.slice(1)) - 1];
        if (!linkHref) return false;
      }
    }
    const ordered: SegMark[] = [
      ...marks.filter((mark) => mark.type === "bold"),
      ...marks.filter((mark) => mark.type === "italic"),
      ...(linkHref ? [{ type: "link" as const, attrs: { href: linkHref } }] : []),
    ];
    content.push(
      ordered.length > 0 ? { type: "text", text, marks: ordered } : { type: "text", text },
    );
    return true;
  };
  for (const match of segment.matchAll(TAG)) {
    if (!pushText(segment.slice(cursor, match.index))) return { ok: false };
    cursor = match.index + match[0].length;
    const closing = match[1] === "/";
    const name = match[2]!;
    if (name === "br/") {
      if (closing) return { ok: false };
      content.push({ type: "hardBreak" });
    } else if (match[4] !== undefined) {
      if (closing) return { ok: false };
      const fieldId = segmentation.fields[Number(match[4]) - 1];
      if (!fieldId) return { ok: false };
      content.push({ type: "lockedField", attrs: { fieldId } });
    } else if (closing) {
      if (open.pop() !== name) return { ok: false };
    } else {
      if (open.includes(name)) return { ok: false };
      open.push(name);
    }
  }
  if (!pushText(segment.slice(cursor)) || open.length > 0) return { ok: false };
  return { ok: true, content };
}

export type RebuildResult =
  { ok: true; doc: SegDocument } | { ok: false; failedSegments: number[] };

/**
 * Rebuilds a document from translated strings: the same blocks, lists, and links, with each text
 * block's content replaced. Refuses a missing segment and any string whose tags or placeholders
 * differ from its source (FR-047).
 */
export function rebuildDocument(source: SegDocument, translated: readonly string[]): RebuildResult {
  const segmentation = segmentDocument(source);
  const failed: number[] = [];
  const parsed: SegInline[][] = [];
  segmentation.segments.forEach((original, index) => {
    const candidate = translated[index];
    if (candidate === undefined || !tokensMatch(original, candidate)) {
      failed.push(index);
      parsed.push([]);
      return;
    }
    const outcome = parseSegment(candidate, segmentation);
    if (!outcome.ok) {
      failed.push(index);
      parsed.push([]);
      return;
    }
    parsed.push(outcome.content);
  });
  if (failed.length > 0 || translated.length !== segmentation.segments.length) {
    return {
      ok: false,
      failedSegments: failed.length > 0 ? failed : [segmentation.segments.length],
    };
  }
  const copy = structuredClone(source);
  textBlocks(copy).forEach((block, index) => {
    const content = parsed[index] ?? [];
    if (content.length > 0) block.content = content;
    else delete block.content;
  });
  return { ok: true, doc: copy };
}

/** Plain text of a document, one line per text block, for checks that read words. */
export function docPlainText(doc: SegDocument | null | undefined): string {
  if (!doc) return "";
  return textBlocks(doc)
    .map((block) =>
      (block.content ?? [])
        .map((inline) =>
          inline.type === "text" ? inline.text : inline.type === "hardBreak" ? "\n" : " ",
        )
        .join(""),
    )
    .join("\n");
}

/** Link addresses and locked-field IDs of a document. */
export function docReferences(doc: SegDocument | null | undefined): {
  links: string[];
  fields: string[];
} {
  if (!doc) return { links: [], fields: [] };
  const { links, fields } = segmentDocument(doc);
  return { links: [...new Set(links)], fields: [...new Set(fields)] };
}

/** Plain text of each text block, in reading order, for per-block checks such as code warnings. */
export function docBlockTexts(doc: SegDocument | null | undefined): string[] {
  if (!doc) return [];
  return textBlocks(doc).map((block) =>
    (block.content ?? [])
      .map((inline) =>
        inline.type === "text" ? inline.text : inline.type === "hardBreak" ? "\n" : " ",
      )
      .join(""),
  );
}
