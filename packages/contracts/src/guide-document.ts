import { z } from "zod";

/**
 * The content document of a guide item (feature 003 research R2): a JSON tree in a fixed subset of
 * the ProseMirror format, so the editor (Tiptap) produces it directly and the guest renderer and
 * the translation segmenter read one format.
 *
 * Every write goes through `parseGuideDocument`, which refuses anything outside the subset with
 * the path of the first problem and returns a normalized copy. Nothing is ever stored as HTML,
 * which is how pasted scripts and event attributes are kept out (SEC-11, AC-SEC-008).
 */

export const DOCUMENT_MAX_TEXT_LENGTH = 20_000;
const MAX_NODES = 4_000;
const MAX_LIST_DEPTH = 3;
const MAX_HREF_LENGTH = 2_000;
const LINK_PROTOCOLS = new Set(["https:", "http:", "mailto:", "tel:"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type GuideMark =
  { type: "bold" } | { type: "italic" } | { type: "link"; attrs: { href: string } };

export type GuideInline =
  | { type: "text"; text: string; marks?: GuideMark[] }
  | { type: "hardBreak" }
  | { type: "lockedField"; attrs: { fieldId: string } };

export interface GuideParagraph {
  type: "paragraph";
  content?: GuideInline[];
}
export interface GuideHeading {
  type: "heading";
  attrs: { level: 3 | 4 };
  content?: GuideInline[];
}
export interface GuideListItem {
  type: "listItem";
  content: (GuideParagraph | GuideList)[];
}
export type GuideList =
  | { type: "bulletList"; content: GuideListItem[] }
  | { type: "orderedList"; attrs?: { start: number }; content: GuideListItem[] };
export type GuideBlock = GuideParagraph | GuideHeading | GuideList;

export interface GuideDocument {
  type: "doc";
  content: GuideBlock[];
}

export interface ParseOptions {
  /** False for shared blocks, which cannot hold locked fields (FR-057). */
  allowLockedFields?: boolean;
}

export type ParseResult =
  { ok: true; doc: GuideDocument } | { ok: false; path: string; message: string };

class Refusal extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function join(path: string, key: string | number): string {
  return path ? `${path}.${key}` : String(key);
}

/** Refuses keys outside `allowed`; `type` is always allowed. */
function onlyKeys(node: Json, path: string, allowed: readonly string[]): void {
  for (const key of Object.keys(node)) {
    if (key !== "type" && !allowed.includes(key))
      throw new Refusal(join(path, key), `Unexpected key "${key}"`);
  }
}

class Parser {
  private nodes = 0;
  private textLength = 0;

  constructor(private readonly allowLockedFields: boolean) {}

  private count(path: string): void {
    this.nodes += 1;
    if (this.nodes > MAX_NODES) throw new Refusal(path, "The document has too many nodes");
  }

  doc(input: unknown): GuideDocument {
    if (!isObject(input)) throw new Refusal("", "A document must be an object");
    if (input.type !== "doc") throw new Refusal("type", 'The root must be "doc"');
    onlyKeys(input, "", ["content"]);
    const content = input.content ?? [];
    if (!Array.isArray(content)) throw new Refusal("content", "Content must be a list");
    return {
      type: "doc",
      content: content.map((block, index) => this.block(block, join("content", index), 0)),
    };
  }

  private block(input: unknown, path: string, listDepth: number): GuideBlock {
    if (!isObject(input)) throw new Refusal(path, "A block must be an object");
    this.count(path);
    switch (input.type) {
      case "paragraph":
        onlyKeys(input, path, ["content"]);
        return this.withInline({ type: "paragraph" }, input, path);
      case "heading": {
        onlyKeys(input, path, ["attrs", "content"]);
        const attrs = input.attrs;
        if (!isObject(attrs)) throw new Refusal(join(path, "attrs"), "A heading needs a level");
        onlyKeys(attrs, join(path, "attrs"), ["level"]);
        if (attrs.level !== 3 && attrs.level !== 4) {
          throw new Refusal(join(path, "attrs.level"), "Headings are level 3 or 4");
        }
        return this.withInline({ type: "heading", attrs: { level: attrs.level } }, input, path);
      }
      case "bulletList":
      case "orderedList":
        return this.list(input, path, listDepth + 1);
      default:
        throw new Refusal(join(path, "type"), `Block "${String(input.type)}" is not allowed`);
    }
  }

  private list(input: Json, path: string, depth: number): GuideList {
    if (depth > MAX_LIST_DEPTH) throw new Refusal(path, "Lists nest at most three levels deep");
    onlyKeys(input, path, input.type === "orderedList" ? ["attrs", "content"] : ["content"]);
    const content = input.content;
    if (!Array.isArray(content) || content.length === 0) {
      throw new Refusal(join(path, "content"), "A list needs at least one item");
    }
    const items = content.map((item, index) =>
      this.listItem(item, join(join(path, "content"), index), depth),
    );
    if (input.type === "bulletList") return { type: "bulletList", content: items };
    const attrs = input.attrs;
    if (attrs === undefined || attrs === null) return { type: "orderedList", content: items };
    if (!isObject(attrs)) throw new Refusal(join(path, "attrs"), "Attributes must be an object");
    onlyKeys(attrs, join(path, "attrs"), ["start", "type"]);
    const start = attrs.start ?? 1;
    if (!Number.isInteger(start) || (start as number) < 1 || (start as number) > 999) {
      throw new Refusal(join(path, "attrs.start"), "A list starts between 1 and 999");
    }
    return start === 1
      ? { type: "orderedList", content: items }
      : { type: "orderedList", attrs: { start: start as number }, content: items };
  }

  private listItem(input: unknown, path: string, depth: number): GuideListItem {
    if (!isObject(input) || input.type !== "listItem") {
      throw new Refusal(join(path, "type"), "A list holds list items only");
    }
    this.count(path);
    onlyKeys(input, path, ["content"]);
    const content = input.content;
    if (!Array.isArray(content) || content.length === 0) {
      throw new Refusal(join(path, "content"), "A list item needs content");
    }
    return {
      type: "listItem",
      content: content.map((child, index) => {
        const childPath = join(join(path, "content"), index);
        if (isObject(child) && child.type === "paragraph")
          return this.block(child, childPath, depth) as GuideParagraph;
        if (isObject(child) && (child.type === "bulletList" || child.type === "orderedList")) {
          this.count(childPath);
          return this.list(child, childPath, depth + 1);
        }
        throw new Refusal(join(childPath, "type"), "A list item holds paragraphs and lists only");
      }),
    };
  }

  private withInline<T extends GuideParagraph | GuideHeading>(
    node: T,
    input: Json,
    path: string,
  ): T {
    const content = input.content;
    if (content === undefined || content === null) return node;
    if (!Array.isArray(content)) throw new Refusal(join(path, "content"), "Content must be a list");
    if (content.length === 0) return node;
    node.content = content.map((inline, index) =>
      this.inline(inline, join(join(path, "content"), index)),
    );
    return node;
  }

  private inline(input: unknown, path: string): GuideInline {
    if (!isObject(input)) throw new Refusal(path, "An inline node must be an object");
    this.count(path);
    switch (input.type) {
      case "text": {
        onlyKeys(input, path, ["text", "marks"]);
        if (typeof input.text !== "string" || input.text.length === 0) {
          throw new Refusal(join(path, "text"), "Text nodes need text");
        }
        this.textLength += input.text.length;
        if (this.textLength > DOCUMENT_MAX_TEXT_LENGTH) {
          throw new Refusal(join(path, "text"), "The document is longer than 20,000 characters");
        }
        const marks = this.marks(input.marks, join(path, "marks"));
        return marks.length > 0
          ? { type: "text", text: input.text, marks }
          : { type: "text", text: input.text };
      }
      case "hardBreak":
        onlyKeys(input, path, []);
        return { type: "hardBreak" };
      case "lockedField": {
        if (!this.allowLockedFields)
          throw new Refusal(join(path, "type"), "Locked fields are not allowed here");
        onlyKeys(input, path, ["attrs"]);
        const attrs = input.attrs;
        if (!isObject(attrs)) throw new Refusal(join(path, "attrs"), "A locked field needs its ID");
        onlyKeys(attrs, join(path, "attrs"), ["fieldId"]);
        if (typeof attrs.fieldId !== "string" || !UUID.test(attrs.fieldId)) {
          throw new Refusal(join(path, "attrs.fieldId"), "A locked field ID is a UUID");
        }
        return { type: "lockedField", attrs: { fieldId: attrs.fieldId } };
      }
      default:
        throw new Refusal(join(path, "type"), `Inline node "${String(input.type)}" is not allowed`);
    }
  }

  private marks(input: unknown, path: string): GuideMark[] {
    if (input === undefined || input === null) return [];
    if (!Array.isArray(input)) throw new Refusal(path, "Marks must be a list");
    const seen = new Set<string>();
    const marks: GuideMark[] = [];
    input.forEach((mark, index) => {
      const markPath = join(path, index);
      if (!isObject(mark)) throw new Refusal(markPath, "A mark must be an object");
      const type = mark.type;
      if (type === "bold" || type === "italic") {
        onlyKeys(mark, markPath, []);
        if (!seen.has(type)) marks.push({ type });
      } else if (type === "link") {
        marks.push({ type: "link", attrs: { href: this.href(mark, markPath) } });
      } else {
        throw new Refusal(join(markPath, "type"), `Mark "${String(type)}" is not allowed`);
      }
      seen.add(String(type));
    });
    return marks;
  }

  /** The link's address, normalized; the editor's own attributes are dropped when at their defaults. */
  private href(mark: Json, path: string): string {
    onlyKeys(mark, path, ["attrs"]);
    const attrs = mark.attrs;
    if (!isObject(attrs)) throw new Refusal(join(path, "attrs"), "A link needs an address");
    onlyKeys(attrs, join(path, "attrs"), ["href", "target", "rel", "class"]);
    if (attrs.target !== undefined && attrs.target !== null && attrs.target !== "_blank") {
      throw new Refusal(join(path, "attrs.target"), "Links open in a new tab or not at all");
    }
    if (attrs.class !== undefined && attrs.class !== null) {
      throw new Refusal(join(path, "attrs.class"), "Links carry no class");
    }
    const raw = attrs.href;
    if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_HREF_LENGTH) {
      throw new Refusal(
        join(path, "attrs.href"),
        "A link needs an address of at most 2,000 characters",
      );
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Refusal(join(path, "attrs.href"), "The link is not a valid address");
    }
    if (!LINK_PROTOCOLS.has(url.protocol)) {
      throw new Refusal(join(path, "attrs.href"), "Links use https, http, mailto, or tel");
    }
    return url.href;
  }
}

/** Validates and normalizes a document. */
export function parseGuideDocument(input: unknown, options: ParseOptions = {}): ParseResult {
  try {
    return { ok: true, doc: new Parser(options.allowLockedFields ?? true).doc(input) };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, path: error.path, message: error.message };
    throw error;
  }
}

function schemaFor(options: ParseOptions) {
  return z.unknown().transform((input, ctx): GuideDocument => {
    const result = parseGuideDocument(input, options);
    if (!result.ok) {
      ctx.addIssue({
        code: "custom",
        message: result.message,
        path: result.path ? result.path.split(".") : [],
      });
      return z.NEVER;
    }
    return result.doc;
  });
}

/** A guide item's document, for request bodies. */
export const guideDocumentSchema = schemaFor({ allowLockedFields: true });
/** A shared block item's document: no locked fields (FR-057). */
export const sharedBlockDocumentSchema = schemaFor({ allowLockedFields: false });

/** Walks every inline node in reading order, with a callback at the end of each block. */
function walk(
  doc: GuideDocument,
  onInline: (node: GuideInline) => void,
  onBlockEnd: () => void,
): void {
  const visitBlock = (block: GuideBlock | GuideListItem): void => {
    if (block.type === "paragraph" || block.type === "heading") {
      for (const inline of block.content ?? []) onInline(inline);
      onBlockEnd();
      return;
    }
    for (const child of block.content) visitBlock(child);
  };
  for (const block of doc.content) visitBlock(block);
}

/** Plain text, one line per block; hard breaks are new lines and locked fields `[locked]`. */
export function documentPlainText(doc: GuideDocument): string {
  const lines: string[] = [];
  let current = "";
  walk(
    doc,
    (node) => {
      if (node.type === "text") current += node.text;
      else if (node.type === "hardBreak") current += "\n";
      else current += "[locked]";
    },
    () => {
      lines.push(current);
      current = "";
    },
  );
  return lines.join("\n");
}

/** Characters of text, for the 20,000-character limit (FR-010). */
export function documentTextLength(doc: GuideDocument): number {
  let length = 0;
  walk(
    doc,
    (node) => {
      if (node.type === "text") length += node.text.length;
    },
    () => undefined,
  );
  return length;
}

/** The locked fields a document references, in order, without repeats. */
export function documentLockedFieldIds(doc: GuideDocument): string[] {
  const ids: string[] = [];
  walk(
    doc,
    (node) => {
      if (node.type === "lockedField" && !ids.includes(node.attrs.fieldId))
        ids.push(node.attrs.fieldId);
    },
    () => undefined,
  );
  return ids;
}

/** Every link address in a document, in order, without repeats. */
export function documentLinks(doc: GuideDocument): string[] {
  const links: string[] = [];
  walk(
    doc,
    (node) => {
      if (node.type !== "text") return;
      for (const mark of node.marks ?? []) {
        if (mark.type === "link" && !links.includes(mark.attrs.href)) links.push(mark.attrs.href);
      }
    },
    () => undefined,
  );
  return links;
}

/** A document with one paragraph per line of `text`, for drafted content. */
export function documentFromPlainText(text: string): GuideDocument {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return {
    type: "doc",
    content: paragraphs.map((block) => {
      const lines = block.split("\n");
      const content: GuideInline[] = [];
      lines.forEach((line, index) => {
        if (index > 0) content.push({ type: "hardBreak" });
        if (line.length > 0) content.push({ type: "text", text: line });
      });
      return { type: "paragraph", content };
    }),
  };
}
