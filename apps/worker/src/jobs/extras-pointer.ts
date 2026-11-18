import { and, asc, eq } from "drizzle-orm";
import { extra, guideLink, type Database } from "@guidesk/db";
import { localized, type KnowledgeExtra } from "@guidesk/domain";

/** At most this many extras in the knowledge; the page lists every one. */
const MAX_EXTRAS = 20;

/**
 * The host's visible extras and the guide's Extras page for the guide chat's knowledge (feature 008
 * research R8, FR-021), or null when the property shows no extras or has no active guide link. Host
 * content only (names, prices, currencies); never used for copilot drafts (FR-022, PC-10).
 */
export async function extrasFor(
  db: Database,
  target: { workspaceId: string; propertyId: string },
  language: "es" | "en",
  guideUrl: string,
): Promise<{ extras: KnowledgeExtra[]; extrasUrl: string } | null> {
  const rows = await db
    .select({
      name: extra.name,
      sourceLanguage: extra.sourceLanguage,
      price: extra.price,
      currency: extra.currency,
    })
    .from(extra)
    .where(
      and(
        eq(extra.workspaceId, target.workspaceId),
        eq(extra.propertyId, target.propertyId),
        eq(extra.visible, true),
      ),
    )
    .orderBy(asc(extra.position), asc(extra.createdAt))
    .limit(MAX_EXTRAS);
  if (rows.length === 0) return null;
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
  let end = guideUrl.length;
  while (end > 0 && guideUrl[end - 1] === "/") end -= 1;
  return {
    extras: rows.map((row) => ({
      name: localized(row.name, language, row.sourceLanguage).text,
      price: row.price,
      currency: row.currency,
    })),
    extrasUrl: `${guideUrl.slice(0, end)}/g/${link.publicId}/${language}/extras`,
  };
}
