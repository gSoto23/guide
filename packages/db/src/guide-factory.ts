import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import type { Transaction } from "./rls.js";
import { DEFAULT_SECTION_KINDS, guide, guideItem, guideSection } from "./schema/guides.js";

/** The fact items every guide starts with (feature 003 research R16, FR-006). */
const DEFAULT_FACT_ITEMS = [
  { sectionKind: "arrival", factKey: "check_in_time", position: 0 },
  { sectionKind: "arrival", factKey: "address", position: 1 },
  { sectionKind: "house_rules", factKey: "max_guests", position: 0 },
  { sectionKind: "checkout", factKey: "checkout_time", position: 0 },
] as const;

export interface NewGuideInput {
  workspaceId: string;
  propertyId: string;
  /** The property's guide languages; the first is the main language (FR-003). */
  guideLanguages: readonly ("es" | "en")[];
}

/**
 * Creates a property's guide with the nine default sections and the fact items (feature 003
 * FR-001, research R16), in the caller's transaction. Every property creation path calls it, so a
 * property never exists without its guide. Idempotent: a property that already has a guide keeps
 * it. Works in the request context (owners and admins) and in the worker's system context.
 */
export async function createGuideForProperty(
  db: Database | Transaction,
  input: NewGuideInput,
): Promise<{ guideId: string; created: boolean }> {
  const [inserted] = await db
    .insert(guide)
    .values({ workspaceId: input.workspaceId, propertyId: input.propertyId })
    .onConflictDoNothing({ target: guide.propertyId })
    .returning({ id: guide.id });
  if (!inserted) {
    const [existing] = await db
      .select({ id: guide.id })
      .from(guide)
      .where(sql`${guide.propertyId} = ${input.propertyId}`);
    if (!existing) throw new Error("The property's guide could not be created");
    return { guideId: existing.id, created: false };
  }
  const guideId = inserted.id;
  const sections = await db
    .insert(guideSection)
    .values(
      DEFAULT_SECTION_KINDS.map((kind, position) => ({
        workspaceId: input.workspaceId,
        guideId,
        kind,
        position,
      })),
    )
    .returning({ id: guideSection.id, kind: guideSection.kind });
  const sectionId = new Map(sections.map((section) => [section.kind, section.id]));
  const language = input.guideLanguages[0] ?? "es";
  const now = new Date();
  await db.insert(guideItem).values(
    DEFAULT_FACT_ITEMS.map((fact) => ({
      workspaceId: input.workspaceId,
      sectionId: sectionId.get(fact.sectionKind)!,
      kind: "fact" as const,
      position: fact.position,
      source: "host" as const,
      reviewedAt: now,
      sourceLanguage: language,
      factKey: fact.factKey,
    })),
  );
  return { guideId, created: true };
}
