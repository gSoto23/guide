import { and, eq, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";
import {
  experience,
  experienceDestination,
  experiencePartnerReference,
  experienceRefresh,
  exploreSettings,
  guide,
  property,
  workspace,
  type Database,
} from "@guidesk/db";
import {
  categoryForTags,
  destinationKey,
  effectiveExploreSettings,
  JOB_QUEUES,
  matchPartnerDestination,
  VIATOR_KEEP_MINUTES,
  type ExperienceCategory,
} from "@guidesk/domain";
import {
  ExperiencePartnerError,
  type CuratedCatalog,
  type ExperienceLanguage,
  type ExperiencePartnerPort,
  type PartnerDestination,
  type PartnerTag,
} from "@guidesk/integrations";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Explore refresh (feature 009 research R2, R4, R5): every 30 minutes, for each destination with a
 * published guide whose experiences are on, search Viator in Spanish and English and store the
 * results for at most an hour (Viator's keeping limit), dropping products it no longer lists. Guests
 * read only what is stored (FR-017). Failures keep the last results until they expire; after three
 * failures in a run the partner is skipped. Logs and spans carry counts and error codes only.
 */
export const EXPLORE_REFRESH_CRON = "*/30 * * * *";
export const EXPLORE_REFERENCES_CRON = "0 5 * * 1";

const LANGUAGES: ExperienceLanguage[] = ["es", "en"];
const SEARCH_COUNT = 30;
const SKIP_AFTER_FAILURES = 3;
/** Re-map a destination's partner ID weekly, as Viator refreshes destinations weekly (R5). */
const REMAP_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;

export interface ExploreRefreshDeps {
  db: Database;
  /** Null when the deployment has no Viator account (FR-019). */
  partner: ExperiencePartnerPort | null;
  curated: CuratedCatalog;
  now?: () => Date;
  span?: JobSpanDeps;
}

export interface ExploreRefreshReport {
  destinations: number;
  searched: number;
  stored: number;
  failed: number;
  skipped: number;
  cleaned: number;
}

interface ActiveDestination {
  key: string;
  country: string;
  city: string;
  region: string | null;
}

/** Destinations of active properties with a published guide whose experiences are on (R4). */
export async function activeDestinations(db: Database): Promise<ActiveDestination[]> {
  const rows = await db
    .select({
      workspaceId: property.workspaceId,
      propertyId: property.id,
      country: property.country,
      city: property.city,
      region: property.region,
    })
    .from(property)
    .innerJoin(guide, eq(guide.propertyId, property.id))
    .innerJoin(workspace, eq(workspace.id, property.workspaceId))
    .where(
      and(
        eq(property.status, "active"),
        eq(workspace.status, "active"),
        eq(guide.status, "published"),
        isNotNull(guide.publishedVersionId),
        isNotNull(property.country),
        isNotNull(property.city),
      ),
    );
  if (rows.length === 0) return [];
  const settings = await db
    .select()
    .from(exploreSettings)
    .where(inArray(exploreSettings.workspaceId, [...new Set(rows.map((row) => row.workspaceId))]));
  const byWorkspace = new Map(
    settings.filter((row) => row.propertyId === null).map((row) => [row.workspaceId, row]),
  );
  const byProperty = new Map(
    settings.filter((row) => row.propertyId !== null).map((row) => [row.propertyId!, row]),
  );
  const out = new Map<string, ActiveDestination>();
  for (const row of rows) {
    const key = destinationKey(row.country, row.city);
    if (!key || out.has(key)) continue;
    const workspaceRow = byWorkspace.get(row.workspaceId);
    const propertyRow = byProperty.get(row.propertyId);
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
    if (!effective.experiencesEnabled) continue;
    out.set(key, {
      key,
      country: row.country!.toUpperCase(),
      city: row.city!.slice(0, 120),
      region: row.region ? row.region.slice(0, 120) : null,
    });
  }
  return [...out.values()];
}

async function readReference<T>(db: Database, kind: "destinations" | "tags"): Promise<T[] | null> {
  const [row] = await db
    .select({ data: experiencePartnerReference.data })
    .from(experiencePartnerReference)
    .where(
      and(
        eq(experiencePartnerReference.partner, "viator"),
        eq(experiencePartnerReference.kind, kind),
      ),
    )
    .limit(1);
  return row ? (row.data as T[]) : null;
}

async function writeReference(
  db: Database,
  kind: "destinations" | "tags",
  data: unknown[],
  now: Date,
): Promise<void> {
  await db
    .insert(experiencePartnerReference)
    .values({ partner: "viator", kind, data, fetchedAt: now })
    .onConflictDoUpdate({
      target: [experiencePartnerReference.partner, experiencePartnerReference.kind],
      set: { data, fetchedAt: now },
    });
}

/** Viator's destinations and tags, refreshed weekly (research R4); returns how many were stored. */
export async function runExploreReferences(
  deps: Pick<ExploreRefreshDeps, "db" | "partner" | "now">,
): Promise<{ destinations: number; tags: number }> {
  if (!deps.partner) return { destinations: 0, tags: 0 };
  const now = deps.now?.() ?? new Date();
  const destinations = await deps.partner.destinations();
  const tags = await deps.partner.tags();
  if (destinations.length > 0) await writeReference(deps.db, "destinations", destinations, now);
  if (tags.length > 0) await writeReference(deps.db, "tags", tags, now);
  return { destinations: destinations.length, tags: tags.length };
}

function tagNames(tags: readonly PartnerTag[]): (ids: number[]) => string[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  return (ids) => {
    const names: string[] = [];
    const seen = new Set<number>();
    const queue = [...ids];
    while (queue.length > 0 && seen.size < 50) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const tag = byId.get(id);
      if (!tag) continue;
      names.push(tag.name);
      queue.push(...tag.parentIds);
    }
    return names;
  };
}

export async function runExploreRefresh(deps: ExploreRefreshDeps): Promise<ExploreRefreshReport> {
  const { db, partner, curated } = deps;
  const now = deps.now?.() ?? new Date();
  const report: ExploreRefreshReport = {
    destinations: 0,
    searched: 0,
    stored: 0,
    failed: 0,
    skipped: 0,
    cleaned: 0,
  };
  const cleaned = await db
    .delete(experience)
    .where(lt(experience.expiresAt, new Date(now.getTime() - DAY_MS)))
    .returning({ id: experience.id });
  report.cleaned = cleaned.length;

  const destinations = await activeDestinations(db);
  report.destinations = destinations.length;
  if (destinations.length === 0) return report;
  await db
    .insert(experienceDestination)
    .values(destinations.map(({ key, country, city, region }) => ({ key, country, city, region })))
    .onConflictDoNothing();
  if (!partner) return report;

  let viatorDestinations = await readReference<PartnerDestination>(db, "destinations");
  let viatorTags = await readReference<PartnerTag>(db, "tags");
  if (!viatorDestinations || !viatorTags) {
    try {
      await runExploreReferences({ db, partner, now: () => now });
      viatorDestinations = await readReference<PartnerDestination>(db, "destinations");
      viatorTags = await readReference<PartnerTag>(db, "tags");
    } catch {
      // Without references nothing can be mapped; the next run tries again.
    }
  }
  const namesFor = tagNames(viatorTags ?? []);
  const stored = await db
    .select()
    .from(experienceDestination)
    .where(
      inArray(
        experienceDestination.key,
        destinations.map((item) => item.key),
      ),
    );
  let failuresInRun = 0;

  for (const row of stored) {
    if (failuresInRun >= SKIP_AFTER_FAILURES) {
      report.skipped += 1;
      continue;
    }
    // A curated pin wins; otherwise the stored mapping, refreshed weekly (R5).
    let viatorId = curated.get(row.key)?.viatorDestinationId ?? null;
    if (!viatorId) {
      const fresh = row.mappedAt && now.getTime() - row.mappedAt.getTime() < REMAP_MS;
      viatorId = fresh
        ? row.viatorDestinationId
        : matchPartnerDestination(viatorDestinations ?? [], {
            country: row.country,
            city: row.city,
            region: row.region,
          });
    }
    if (viatorId !== row.viatorDestinationId || !row.mappedAt) {
      await db
        .update(experienceDestination)
        .set({ viatorDestinationId: viatorId, mappedAt: now })
        .where(eq(experienceDestination.key, row.key));
    }
    if (!viatorId) {
      // No partner coverage: nothing to keep for this destination.
      await db
        .delete(experience)
        .where(and(eq(experience.destinationKey, row.key), eq(experience.partner, "viator")));
      continue;
    }

    let error: string | null = null;
    for (const language of LANGUAGES) {
      try {
        report.searched += 1;
        const found = await partner.search({
          destinationId: viatorId,
          language,
          currency: "USD",
          count: SEARCH_COUNT,
        });
        const expiresAt = new Date(now.getTime() + VIATOR_KEEP_MINUTES * 60_000);
        const values = found.map((item) => ({
          partner: "viator" as const,
          productId: item.productId,
          destinationKey: row.key,
          language,
          category: categoryForTags(namesFor(item.tagIds)),
          title: item.title,
          description: item.description,
          includes: null,
          durationMinutes: item.durationMinutes,
          priceFrom: item.priceFrom,
          currency: item.currency,
          rating: item.rating,
          reviewCount: item.reviewCount,
          imageUrl: item.image?.url ?? null,
          imageWidth: item.image?.width ?? null,
          imageHeight: item.image?.height ?? null,
          partnerUrl: item.partnerUrl,
          machineTranslated: item.machineTranslated,
          fetchedAt: now,
          expiresAt,
        }));
        await db.transaction(async (tx) => {
          if (values.length > 0) {
            await tx
              .insert(experience)
              .values(values)
              .onConflictDoUpdate({
                target: [
                  experience.partner,
                  experience.productId,
                  experience.destinationKey,
                  experience.language,
                ],
                set: {
                  category: sql`excluded.category`,
                  title: sql`excluded.title`,
                  description: sql`excluded.description`,
                  durationMinutes: sql`excluded.duration_minutes`,
                  priceFrom: sql`excluded.price_from`,
                  currency: sql`excluded.currency`,
                  rating: sql`excluded.rating`,
                  reviewCount: sql`excluded.review_count`,
                  imageUrl: sql`excluded.image_url`,
                  imageWidth: sql`excluded.image_width`,
                  imageHeight: sql`excluded.image_height`,
                  partnerUrl: sql`excluded.partner_url`,
                  machineTranslated: sql`excluded.machine_translated`,
                  fetchedAt: sql`excluded.fetched_at`,
                  expiresAt: sql`excluded.expires_at`,
                },
              });
          }
          // Products the partner no longer lists are dropped (FR-015).
          await tx.delete(experience).where(
            and(
              eq(experience.destinationKey, row.key),
              eq(experience.partner, "viator"),
              eq(experience.language, language),
              ...(values.length > 0
                ? [
                    notInArray(
                      experience.productId,
                      values.map((value) => value.productId),
                    ),
                  ]
                : []),
            ),
          );
        });
        report.stored += values.length;
      } catch (cause) {
        error = cause instanceof ExperiencePartnerError ? cause.code : "invalid";
        break;
      }
    }
    if (error) {
      report.failed += 1;
      failuresInRun += 1;
    }
    await db
      .insert(experienceRefresh)
      .values({
        destinationKey: row.key,
        partner: "viator",
        lastAttemptAt: now,
        lastSuccessAt: error ? null : now,
        failures: error ? 1 : 0,
        lastError: error as "timeout" | null,
      })
      .onConflictDoUpdate({
        target: [experienceRefresh.destinationKey, experienceRefresh.partner],
        set: error
          ? {
              lastAttemptAt: now,
              failures: sql`${experienceRefresh.failures} + 1`,
              lastError: error as "timeout",
            }
          : { lastAttemptAt: now, lastSuccessAt: now, failures: 0, lastError: null },
      });
  }
  return report;
}

/** The pg-boss handlers: one span per run with counts only (constitution VIII). */
export function createExploreRefreshHandler(deps: ExploreRefreshDeps) {
  return async (): Promise<void> => {
    await runInJobSpan(
      { queue: JOB_QUEUES.exploreRefresh },
      async (span) => {
        const report = await runExploreRefresh(deps);
        span.set({
          "job.outcome": "completed",
          "explore.destinations": report.destinations,
          "explore.searched": report.searched,
          "explore.stored": report.stored,
          "explore.failed": report.failed,
          "explore.skipped": report.skipped,
          "explore.cleaned": report.cleaned,
        });
      },
      deps.span,
    );
  };
}

export function createExploreReferencesHandler(deps: ExploreRefreshDeps) {
  return async (): Promise<void> => {
    await runInJobSpan(
      { queue: JOB_QUEUES.exploreReferences },
      async (span) => {
        const counts = await runExploreReferences(deps);
        span.set({
          "job.outcome": "completed",
          "explore.destinations": counts.destinations,
          "explore.tags": counts.tags,
        });
      },
      deps.span,
    );
  };
}
