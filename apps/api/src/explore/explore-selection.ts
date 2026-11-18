import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt } from "drizzle-orm";
import { experience, exploreSettings, property, type Database } from "@guidesk/db";
import {
  destinationKey,
  effectiveExploreSettings,
  experienceRef,
  PARTNER_NAMES,
  selectExperiences,
  type ExperienceCandidate,
  type ExperienceCategory,
  type ExploreSettingsRow,
  type ExploreSettingsValues,
} from "@guidesk/domain";
import { loadCuratedCatalog, type CuratedCatalog } from "@guidesk/integrations";
import type { ExperienceCard } from "@guidesk/contracts";
import { API_CONFIG, type ApiConfig } from "../config/config.js";

type Language = "es" | "en";

/** An experience with its partner page, which never leaves the API except as a redirect. */
export interface ExploreCandidate extends ExperienceCandidate {
  card: ExperienceCard;
  partnerUrl: string;
}

export interface ExploreSettingsState {
  workspace: (ExploreSettingsValues & { version: number }) | null;
  property: (ExploreSettingsRow & { version: number }) | null;
  effective: ExploreSettingsValues & { hiddenExperiences: string[] };
}

export interface PropertyExploreState extends ExploreSettingsState {
  city: string | null;
  key: string | null;
  candidates: ExploreCandidate[];
  selected: ExploreCandidate[];
}

/**
 * The experiences a property's guests see (feature 009 research R7 to R10), shared by the guest
 * routes (system context) and the member routes (RLS). Reads only stored partner content and the
 * curated file; never calls a partner (FR-017).
 */
@Injectable()
export class ExploreSelection {
  private readonly curated: CuratedCatalog;
  readonly civitatisAffiliateId: string | null;

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    const experiences = config.integrations.experiences;
    this.curated = loadCuratedCatalog(experiences.catalogFile ?? undefined);
    this.civitatisAffiliateId = experiences.civitatisAffiliateId;
  }

  async settings(
    db: Database,
    workspaceId: string,
    propertyId: string | null,
  ): Promise<ExploreSettingsState> {
    const rows = await db
      .select()
      .from(exploreSettings)
      .where(eq(exploreSettings.workspaceId, workspaceId));
    const workspaceRow = rows.find((row) => row.propertyId === null) ?? null;
    const propertyRow = propertyId
      ? (rows.find((row) => row.propertyId === propertyId) ?? null)
      : null;
    const workspace = workspaceRow
      ? {
          experiencesEnabled: workspaceRow.experiencesEnabled,
          hiddenCategories: workspaceRow.hiddenCategories as ExperienceCategory[],
          version: workspaceRow.version,
        }
      : null;
    const own = propertyRow
      ? {
          followsDefault: propertyRow.followsDefault,
          experiencesEnabled: propertyRow.experiencesEnabled,
          hiddenCategories: propertyRow.hiddenCategories as ExperienceCategory[],
          hiddenExperiences: propertyRow.hiddenExperiences,
          version: propertyRow.version,
        }
      : null;
    return { workspace, property: own, effective: effectiveExploreSettings(workspace, own) };
  }

  /** Every current experience for a destination, in the language asked when available. */
  async candidates(
    db: Database,
    key: string | null,
    language: Language,
  ): Promise<ExploreCandidate[]> {
    if (!key) return [];
    const rows = await db
      .select()
      .from(experience)
      .where(and(eq(experience.destinationKey, key), gt(experience.expiresAt, new Date())));
    const byProduct = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const current = byProduct.get(row.productId);
      if (!current || (current.language !== language && row.language === language)) {
        byProduct.set(row.productId, row);
      }
    }
    const out: ExploreCandidate[] = [];
    for (const row of byProduct.values()) {
      const ref = experienceRef(row.partner, row.productId);
      const category = row.category as ExperienceCategory;
      out.push({
        ref,
        partner: row.partner,
        category,
        rating: row.rating,
        reviewCount: row.reviewCount,
        partnerUrl: row.partnerUrl,
        card: {
          ref,
          partner: row.partner,
          partnerName: PARTNER_NAMES[row.partner],
          category,
          title: row.title,
          description: row.description,
          includes: row.includes,
          durationMinutes: row.durationMinutes,
          priceFrom: row.priceFrom,
          currency: row.currency,
          rating: row.rating,
          reviewCount: row.reviewCount,
          image:
            row.imageUrl && row.imageWidth && row.imageHeight
              ? { url: row.imageUrl, width: row.imageWidth, height: row.imageHeight }
              : null,
          language: row.language,
          machineTranslated: row.machineTranslated,
        },
      });
    }
    // Curated Civitatis entries only with Guidesk's affiliate number (FR-019, research R3).
    if (this.civitatisAffiliateId) {
      for (const entry of this.curated.get(key)?.civitatis ?? []) {
        const ref = experienceRef("civitatis", entry.id);
        out.push({
          ref,
          partner: "civitatis",
          curated: true,
          category: entry.category,
          rating: null,
          reviewCount: null,
          partnerUrl: entry.url,
          card: {
            ref,
            partner: "civitatis",
            partnerName: PARTNER_NAMES.civitatis,
            category: entry.category,
            title: entry.title[language],
            description: entry.description[language],
            includes: null,
            durationMinutes: entry.durationMinutes,
            priceFrom: entry.priceFrom,
            currency: entry.currency,
            rating: null,
            reviewCount: null,
            image: null,
            language,
            machineTranslated: false,
          },
        });
      }
    }
    return out;
  }

  /** The property's settings, destination, every candidate, and what guests see. */
  async forProperty(
    db: Database,
    workspaceId: string,
    propertyId: string,
    language: Language,
  ): Promise<PropertyExploreState> {
    const [place] = await db
      .select({ city: property.city, country: property.country })
      .from(property)
      .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
      .limit(1);
    const key = destinationKey(place?.country, place?.city);
    const state = await this.settings(db, workspaceId, propertyId);
    const candidates = await this.candidates(db, key, language);
    return {
      ...state,
      city: place?.city ?? null,
      key,
      candidates,
      selected: selectExperiences(candidates, state.effective),
    };
  }
}
