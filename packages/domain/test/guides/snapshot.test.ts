import { describe, expect, it } from "vitest";
import {
  applySharedBlock,
  buildSnapshot,
  snapshotLockedFieldIds,
  type DraftItem,
  type DraftSection,
  type SharedBlockSnapshot,
} from "../../src/guides/snapshot.js";
import type { SegDocument } from "../../src/guides/segmenter.js";

/** The snapshot builder and shared-block fan-out (feature 003 research R12, R14, T014). */
const FIELD = "3f0c9a52-8a43-4c1e-9d6e-2b7f1c0a9e11";
const docOf = (text: string, field = false): SegDocument => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text },
        ...(field ? [{ type: "lockedField" as const, attrs: { fieldId: FIELD } }] : []),
      ],
    },
  ],
});

function item(id: string, partial: Partial<DraftItem> = {}): DraftItem {
  return {
    id,
    kind: "text",
    position: 0,
    source: "host",
    reviewed: true,
    sourceLanguage: "es",
    topics: [],
    texts: { es: { doc: docOf(`texto ${id}`), origin: "source", state: "current" } },
    ...partial,
  };
}

function section(
  id: string,
  kind: DraftSection["kind"],
  items: DraftItem[],
  partial: Partial<DraftSection> = {},
): DraftSection {
  return { id, kind, position: 0, hidden: false, items, ...partial };
}

const block: SharedBlockSnapshot = {
  blockId: "block-1",
  sectionKind: "checkout",
  position: 0,
  revision: 1,
  items: [
    {
      id: "shared-item",
      kind: "text",
      texts: { es: docOf("Deja las llaves") },
      sourceLanguage: "es",
    },
  ],
};

describe("buildSnapshot", () => {
  it("keeps only reviewed items of visible sections, in order", () => {
    const snapshot = buildSnapshot({
      languages: ["es", "en"],
      sections: [
        section("s2", "wifi", [item("w1")], { position: 1 }),
        section("s1", "arrival", [
          item("a2", { position: 1 }),
          item("a1", { position: 0 }),
          item("a3", { reviewed: false, position: 2 }),
        ]),
        section("s3", "parking", [item("p1")], { position: 2, hidden: true }),
      ],
      sharedBlocks: [],
      links: {},
    });
    expect(snapshot.sections.map((s) => s.kind)).toEqual(["arrival", "wifi"]);
    expect(snapshot.sections[0]?.items.map((i) => i.id)).toEqual(["a1", "a2"]);
  });

  it("publishes current texts and out-of-date reviewed ones, never stale or failed ones", () => {
    const snapshot = buildSnapshot({
      languages: ["es", "en"],
      sections: [
        section("s1", "arrival", [
          item("current", {
            texts: {
              es: { doc: docOf("hola"), origin: "source", state: "current" },
              en: { doc: docOf("hello"), origin: "machine", state: "current" },
            },
          }),
          item("stale", {
            texts: {
              es: { doc: docOf("hola"), origin: "source", state: "current" },
              en: { doc: docOf("old"), origin: "machine", state: "stale" },
            },
          }),
          item("ood", {
            texts: {
              es: { doc: docOf("hola"), origin: "source", state: "current" },
              en: { doc: docOf("mine"), origin: "reviewed", state: "out_of_date" },
            },
          }),
        ]),
      ],
      sharedBlocks: [],
      links: {},
    });
    const [current, stale, ood] = snapshot.sections[0]!.items;
    expect(Object.keys(current!.texts)).toEqual(["es", "en"]);
    expect(Object.keys(stale!.texts)).toEqual(["es"]);
    expect(Object.keys(ood!.texts)).toEqual(["es", "en"]);
  });

  it("keeps locked fields and facts as references, never values", () => {
    const snapshot = buildSnapshot({
      languages: ["es"],
      sections: [
        section("s1", "arrival", [
          item("f", { kind: "fact", factKey: "check_in_time", texts: {} }),
          item("t", {
            texts: {
              es: { doc: docOf("El código es ", true), origin: "source", state: "current" },
            },
          }),
        ]),
      ],
      sharedBlocks: [],
      links: {},
    });
    expect(snapshot.sections[0]?.items[0]).toMatchObject({
      kind: "fact",
      factKey: "check_in_time",
      texts: {},
    });
    expect(snapshotLockedFieldIds(snapshot)).toEqual([FIELD]);
    expect(JSON.stringify(snapshot)).not.toMatch(/4821|value/);
  });

  it("adds inherited shared blocks after the section's own items, unless overridden or excluded", () => {
    const sections = [section("s9", "checkout", [item("c1")])];
    const inherited = buildSnapshot({
      languages: ["es"],
      sections,
      sharedBlocks: [block],
      links: {},
    });
    expect(inherited.sections[0]?.items.map((i) => [i.id, i.sharedBlockId])).toEqual([
      ["c1", undefined],
      ["shared-item", "block-1"],
    ]);
    for (const mode of ["override", "exclude"] as const) {
      const linked = buildSnapshot({
        languages: ["es"],
        sections,
        sharedBlocks: [block],
        links: { "block-1": mode },
      });
      expect(linked.sections[0]?.items.map((i) => i.id)).toEqual(["c1"]);
    }
  });
});

describe("applySharedBlock (fan-out)", () => {
  const base = buildSnapshot({
    languages: ["es"],
    sections: [section("s9", "checkout", [item("c1"), item("c2", { position: 1 })])],
    sharedBlocks: [block],
    links: {},
  });

  it("replaces the block's items in place", () => {
    const next = applySharedBlock(
      base,
      "block-1",
      { ...block, revision: 2, items: [{ ...block.items[0]!, id: "shared-new" }] },
      undefined,
    );
    expect(next.sections[0]?.items.map((i) => i.id)).toEqual(["c1", "c2", "shared-new"]);
  });

  it("removes a deleted block and leaves overriding guides alone", () => {
    expect(
      applySharedBlock(base, "block-1", null, undefined).sections[0]?.items.map((i) => i.id),
    ).toEqual(["c1", "c2"]);
    const withoutBlock = applySharedBlock(base, "block-1", null, undefined);
    expect(applySharedBlock(withoutBlock, "block-1", block, "override")).toEqual(withoutBlock);
  });

  it("adds a newly published block after the section's own items", () => {
    const empty = buildSnapshot({
      languages: ["es"],
      sections: [section("s9", "checkout", [item("c1")])],
      sharedBlocks: [],
      links: {},
    });
    expect(
      applySharedBlock(empty, "block-1", block, undefined).sections[0]?.items.map((i) => i.id),
    ).toEqual(["c1", "shared-item"]);
  });
});
