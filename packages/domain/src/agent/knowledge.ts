import type { GuideLanguage } from "../properties/core-facts.js";
import type { GuideSnapshot, SnapshotItem } from "../guides/snapshot.js";
import { documentText } from "../guest/messages.js";

/**
 * The knowledge the assistant answers from (feature 005 research R4, ADR-0005 stage 1): the
 * published snapshot as deterministic text, one block per section with its ID, locked fields as
 * labels only, core facts, and recommendations with their benefit note. No timestamps and nothing
 * reordered, so the prompt prefix stays byte-identical and cacheable.
 */
export interface KnowledgeFacts {
  checkInTime: string | null;
  checkoutTime: string | null;
  maxGuests: number | null;
  address: string | null;
}

export interface KnowledgeInput {
  snapshot: GuideSnapshot;
  language: GuideLanguage;
  propertyName: string;
  facts: KnowledgeFacts;
  /** Labels of locked fields by ID; values are never available here. */
  lockedLabels: ReadonlyMap<string, string>;
  /** Public Wi-Fi password by field ID, when the host made it public (spec 003 FR-021). */
  publicValues: ReadonlyMap<string, string>;
  sectionTitle: (kind: string, customTitle: string | null) => string;
  emergencyNumber: string | null;
}

export interface KnowledgeSection {
  id: string;
  kind: string;
  title: string;
}

export interface Knowledge {
  text: string;
  sections: KnowledgeSection[];
}

export function lockedPlaceholder(label: string): string {
  return `«${label}: shown to verified guests in the guide»`;
}

function itemText(item: SnapshotItem, input: KnowledgeInput): string | null {
  const doc = item.texts[input.language] ?? item.texts[item.sourceLanguage];
  const field = (id: string) =>
    input.publicValues.get(id) ?? lockedPlaceholder(input.lockedLabels.get(id) ?? "Locked value");
  if (item.kind === "recommendation" && item.recommendation) {
    const rec = item.recommendation;
    const parts = [`Recommendation: ${rec.name} (${rec.category})`];
    if (rec.address) parts.push(`address: ${rec.address}`);
    if (rec.url) parts.push(`website: ${rec.url}`);
    if (rec.benefit && rec.benefit !== "none") {
      parts.push(
        "disclosure: the host may receive a commission or other benefit from this business",
      );
    }
    const note = doc ? documentText(doc, field) : "";
    return `${parts.join("; ")}${note ? `\n${note}` : ""}`;
  }
  if (item.kind === "fact" || item.kind === "image" || item.kind === "video") return null;
  if (!doc) return null;
  const text = documentText(doc, field).trim();
  return text || null;
}

export function renderKnowledge(input: KnowledgeInput): Knowledge {
  const lines: string[] = [`# Property: ${input.propertyName}`, "", "## Core facts"];
  const { facts } = input;
  if (facts.checkInTime) lines.push(`Check-in: from ${facts.checkInTime}`);
  if (facts.checkoutTime) lines.push(`Checkout: by ${facts.checkoutTime}`);
  if (facts.maxGuests !== null) lines.push(`Maximum guests: ${facts.maxGuests}`);
  if (facts.address) lines.push(`Address: ${facts.address}`);
  if (input.emergencyNumber) lines.push(`Local emergency number: ${input.emergencyNumber}`);
  lines.push("", "## Guide sections");
  const sections: KnowledgeSection[] = [];
  for (const section of input.snapshot.sections) {
    const customTitle =
      section.kind === "custom"
        ? (section.title?.[input.language] ?? Object.values(section.title ?? {})[0] ?? null)
        : null;
    const title = input.sectionTitle(section.kind, customTitle);
    const texts = section.items
      .map((item) => itemText(item, input))
      .filter((text): text is string => text !== null);
    if (texts.length === 0) continue;
    sections.push({ id: section.id, kind: section.kind, title });
    lines.push("", `[section ${section.id}] ${title}`, ...texts);
  }
  return { text: lines.join("\n"), sections };
}

/** The Emergency section as plain text, for the emergency card (FR-018). */
export function emergencyText(input: KnowledgeInput): string | null {
  const section = input.snapshot.sections.find((candidate) => candidate.kind === "emergency");
  if (!section) return null;
  const texts = section.items
    .map((item) => itemText(item, input))
    .filter((text): text is string => text !== null);
  return texts.length ? texts.join("\n") : null;
}
