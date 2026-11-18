import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import type { ChatSectionRef } from "@guidesk/contracts";
import { guide, guideVersion, type Transaction } from "@guidesk/db";
import type { GuideSnapshot } from "@guidesk/domain";

const require = createRequire(import.meta.url);
type GuestCatalog = { sections: Record<string, string> };
const SECTION_TITLES: Record<"es" | "en", Record<string, string>> = {
  es: (require("@guidesk/i18n/messages/guest.es.json") as GuestCatalog).sections,
  en: (require("@guidesk/i18n/messages/guest.en.json") as GuestCatalog).sections,
};

/**
 * Section titles of a property's published guide as guests see them (the guest catalog, or the
 * custom title), for results that cite sections (features 007 and 006).
 */
export async function publishedSectionRefs(
  tx: Transaction,
  workspaceId: string,
  propertyId: string,
  sectionIds: readonly string[],
  language: "es" | "en",
): Promise<ChatSectionRef[]> {
  if (sectionIds.length === 0) return [];
  const [published] = await tx
    .select({ snapshot: guideVersion.snapshot })
    .from(guide)
    .innerJoin(guideVersion, eq(guideVersion.id, guide.publishedVersionId))
    .where(and(eq(guide.propertyId, propertyId), eq(guide.workspaceId, workspaceId)))
    .limit(1);
  const snapshot = published?.snapshot as GuideSnapshot | undefined;
  const names = SECTION_TITLES[language];
  return sectionIds.flatMap((id) => {
    const section = snapshot?.sections.find((candidate) => candidate.id === id);
    if (!section) return [];
    const custom =
      section.kind === "custom"
        ? (section.title?.[language] ?? Object.values(section.title ?? {})[0] ?? null)
        : null;
    return [{ id, title: custom ?? names[section.kind] ?? names.custom ?? section.kind }];
  });
}
