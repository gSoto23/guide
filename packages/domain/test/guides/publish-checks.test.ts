import { describe, expect, it } from "vitest";
import { computeCompleteness } from "../../src/guides/completeness.js";
import { checkPublish, textHash, type PublishCheckInput } from "../../src/guides/publish-checks.js";
import type { SegDocument } from "../../src/guides/segmenter.js";
import type { DraftItem, DraftSection } from "../../src/guides/snapshot.js";
import { DEFAULT_SECTION_KINDS } from "../../src/guides/template.js";

/** The publish check (feature 003 FR-049, FR-050, research R13, T015). */
const FIELD = "3f0c9a52-8a43-4c1e-9d6e-2b7f1c0a9e11";
const docOf = (text: string, opts: { field?: boolean; href?: string } = {}): SegDocument => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text,
          ...(opts.href ? { marks: [{ type: "link" as const, attrs: { href: opts.href } }] } : {}),
        },
        ...(opts.field ? [{ type: "lockedField" as const, attrs: { fieldId: FIELD } }] : []),
      ],
    },
  ],
});

function item(
  id: string,
  text: string,
  partial: Partial<DraftItem> = {},
  opts: Parameters<typeof docOf>[1] = {},
): DraftItem {
  return {
    id,
    kind: "text",
    position: 0,
    source: "host",
    reviewed: true,
    sourceLanguage: "es",
    topics: [],
    texts: { es: { doc: docOf(text, opts), origin: "source", state: "current" } },
    ...partial,
  };
}

function input(
  sections: Partial<Record<string, DraftItem[]>>,
  partial: Partial<PublishCheckInput> = {},
): PublishCheckInput {
  const draft: DraftSection[] = DEFAULT_SECTION_KINDS.map((kind, position) => ({
    id: `s-${kind}`,
    kind,
    position,
    hidden: false,
    items: sections[kind] ?? [],
  }));
  const completeness = computeCompleteness({
    sections: draft.map((section) => ({
      kind: section.kind,
      hidden: section.hidden,
      items: section.items.map((i) => ({
        kind: i.kind,
        texts: [JSON.stringify(i.texts.es?.doc ?? "")],
        topics: i.topics,
      })),
    })),
    setLockedFieldKinds: [],
    facts: {},
    marks: {},
  });
  return {
    setupReady: true,
    workspaceActive: true,
    languages: ["es", "en"],
    sections: draft,
    completeness,
    lockedFields: [],
    codeWarningAcks: {},
    ...partial,
  };
}

describe("checkPublish", () => {
  it("blocks when the core facts are not confirmed or the workspace is pending deletion", () => {
    expect(checkPublish(input({}, { setupReady: false, workspaceActive: false }))).toMatchObject({
      ready: false,
      blockers: ["not_ready", "pending_deletion"],
    });
  });

  it("lists unreviewed items as left out, by section, and ignores hidden sections", () => {
    const result = checkPublish(
      input({
        arrival: [
          item("a1", "Llaves en recepción", { reviewed: false }),
          item("a2", "Bienvenidos"),
        ],
      }),
    );
    expect(result.ready).toBe(true);
    expect(result.leftOut).toEqual([{ sectionId: "s-arrival", itemIds: ["a1"] }]);
  });

  it("warns about missing essentials", () => {
    const kinds = checkPublish(input({}))
      .warnings.filter((w) => w.kind === "missing_essential")
      .map((w) => "topicId" in w && w.topicId);
    expect(kinds).toEqual(["arrival.access_steps", "emergency.contacts", "checkout.steps"]);
  });

  it("warns about locked-field references without a value", () => {
    const sections = { arrival: [item("a1", "El código es ", {}, { field: true })] };
    expect(checkPublish(input(sections)).warnings).toContainEqual({
      kind: "unset_locked_field",
      fieldId: FIELD,
    });
    expect(
      checkPublish(input(sections, { lockedFields: [{ id: FIELD, isSet: true }] })).warnings,
    ).not.toContainEqual({
      kind: "unset_locked_field",
      fieldId: FIELD,
    });
  });

  it("warns about code-like text unless the host kept it", () => {
    const text = "El código de la puerta es 4821";
    const sections = { arrival: [item("a1", text)] };
    expect(checkPublish(input(sections)).warnings).toContainEqual({
      kind: "code_like_text",
      sectionId: "s-arrival",
      itemId: "a1",
    });
    const kept = checkPublish(input(sections, { codeWarningAcks: { a1: textHash(text) } }));
    expect(kept.warnings.some((w) => w.kind === "code_like_text")).toBe(false);
  });

  it.each([
    [
      "a direct-booking phrase in Spanish",
      "La próxima vez reserva directo conmigo y te hago descuento",
      {},
    ],
    ["a payment phrase in English", "You can pay me via bank transfer", {}],
    ["a payment link", "Pay here", { href: "https://paypal.me/someone" }],
  ])("warns about %s (PC-06)", (_name, text, opts) => {
    const result = checkPublish(input({ house_rules: [item("h1", text, {}, opts)] }));
    expect(result.warnings).toContainEqual({
      kind: "off_platform",
      sectionId: "s-house_rules",
      itemId: "h1",
    });
  });

  it("does not flag ordinary text", () => {
    const result = checkPublish(
      input({
        house_rules: [
          item("h1", "No se permiten fiestas. Book a tour with our partner at the front desk."),
        ],
      }),
    );
    expect(result.warnings.some((w) => w.kind === "off_platform")).toBe(false);
  });

  it("counts unreviewed and out-of-date translations", () => {
    const texts = (enState: "current" | "out_of_date", origin: "machine" | "reviewed") => ({
      es: { doc: docOf("hola"), origin: "source" as const, state: "current" as const },
      en: { doc: docOf("hello"), origin, state: enState },
    });
    const result = checkPublish(
      input({
        wifi: [
          item("w1", "x", { texts: texts("current", "machine") }),
          item("w2", "x", { texts: texts("out_of_date", "reviewed") }),
        ],
      }),
    );
    expect(result.warnings).toContainEqual({ kind: "unreviewed_translations", count: 1 });
    expect(result.warnings).toContainEqual({ kind: "out_of_date_translations", count: 1 });
  });
});
