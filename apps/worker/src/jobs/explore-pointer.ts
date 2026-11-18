import { and, eq, gt } from "drizzle-orm";
import { experience, exploreSettings, guideLink, property, type Database } from "@guidesk/db";
import {
  destinationKey,
  effectiveExploreSettings,
  experienceRef,
  exploreVisible,
  selectExperiences,
  type ExperienceCandidate,
  type ExperienceCategory,
  type GuideSnapshot,
} from "@guidesk/domain";
import type { CuratedCatalog } from "@guidesk/integrations";

/** What the worker needs to know about curated entries (feature 009 research R3, R11). */
export interface ExploreKnowledgeDeps {
  curated: CuratedCatalog;
  civitatisAffiliateId: string | null;
}

/**
 * The guide's Explore page for the guide chat's knowledge (feature 009 research R11), or null when
 * Explore doesn't show for the property: no host tips and no selected experience. Same rules as the
 * guest route; never used for copilot drafts (FR-027).
 */
export async function exploreUrlFor(
  db: Database,
  target: { workspaceId: string; propertyId: string },
  language: "es" | "en",
  snapshot: GuideSnapshot,
  guideUrl: string,
  explore?: ExploreKnowledgeDeps,
): Promise<string | null> {
  const tips = snapshot.sections.reduce(
    (count, section) =>
      count + section.items.filter((item) => item.kind === "recommendation").length,
    0,
  );
  let selected = 0;
  if (tips === 0) {
    const [place] = await db
      .select({ city: property.city, country: property.country })
      .from(property)
      .where(and(eq(property.id, target.propertyId), eq(property.workspaceId, target.workspaceId)))
      .limit(1);
    const key = destinationKey(place?.country, place?.city);
    if (key) {
      const rows = await db
        .select()
        .from(exploreSettings)
        .where(eq(exploreSettings.workspaceId, target.workspaceId));
      const workspaceRow = rows.find((row) => row.propertyId === null);
      const propertyRow = rows.find((row) => row.propertyId === target.propertyId);
      const effective = effectiveExploreSettings(
        workspaceRow
          ? {
              experiencesEnabled: workspaceRow.experiencesEnabled,
              hiddenCategories: workspaceRow.hiddenCategories as ExperienceCategory[],
            }
          : null,
        propertyRow
          ? {
              followsDefault: propertyRow.followsDefault,
              experiencesEnabled: propertyRow.experiencesEnabled,
              hiddenCategories: propertyRow.hiddenCategories as ExperienceCategory[],
              hiddenExperiences: propertyRow.hiddenExperiences,
            }
          : null,
      );
      const stored = await db
        .select({
          partner: experience.partner,
          productId: experience.productId,
          category: experience.category,
          rating: experience.rating,
          reviewCount: experience.reviewCount,
        })
        .from(experience)
        .where(and(eq(experience.destinationKey, key), gt(experience.expiresAt, new Date())));
      const candidates: ExperienceCandidate[] = stored.map((row) => ({
        ref: experienceRef(row.partner, row.productId),
        partner: row.partner,
        category: row.category as ExperienceCategory,
        rating: row.rating,
        reviewCount: row.reviewCount,
      }));
      if (explore?.civitatisAffiliateId) {
        for (const entry of explore.curated.get(key)?.civitatis ?? []) {
          candidates.push({
            ref: experienceRef("civitatis", entry.id),
            partner: "civitatis",
            curated: true,
            category: entry.category,
            rating: null,
            reviewCount: null,
          });
        }
      }
      selected = selectExperiences(candidates, effective).length;
    }
  }
  if (!exploreVisible(tips, selected)) return null;
  const [link] = await db
    .select({ publicId: guideLink.publicId })
    .from(guideLink)
    .where(
      and(
        eq(guideLink.workspaceId, target.workspaceId),
        eq(guideLink.propertyId, target.propertyId),
        eq(guideLink.status, "active"),
      ),
    )
    .limit(1);
  if (!link) return null;
  return `${guideUrl.replace(/\/+$/, "")}/g/${link.publicId}/${language}/explore`;
}
