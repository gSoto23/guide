import { z } from "zod";
import type { GuestRecommendation } from "./guest.js";
import { EXPLORE_CATEGORY_VALUES } from "./values.js";

export { EXPLORE_CATEGORY_VALUES };

/**
 * Explore (feature 009 contracts/http-api.md): partner experiences near a property, the guest routes,
 * and the host settings. Partner text is plain text; refs are `viator-{code}` or `civitatis-{id}`.
 */
export type ExploreCategory = (typeof EXPLORE_CATEGORY_VALUES)[number];
export type ExplorePartner = "viator" | "civitatis";

const refSchema = z.string().regex(/^(viator|civitatis)-[A-Za-z0-9_-]{1,64}$/);

export const exploreQuerySchema = z.object({ lang: z.enum(["es", "en"]).optional() }).strict();

export const exploreRedirectQuerySchema = z
  .object({ lang: z.enum(["es", "en"]).optional(), c: z.literal("1").optional() })
  .passthrough();

export interface ExperienceCard {
  ref: string;
  partner: ExplorePartner;
  partnerName: string;
  category: ExploreCategory;
  title: string;
  description: string;
  includes: string | null;
  durationMinutes: number | null;
  priceFrom: number | null;
  currency: string | null;
  rating: number | null;
  reviewCount: number | null;
  image: { url: string; width: number; height: number } | null;
  /** The language of the text: English when the partner has no Spanish (FR-005). */
  language: "es" | "en";
  machineTranslated: boolean;
}

/** `GET /api/v1/guest/guides/{publicId}/explore` (FR-001 to FR-005, FR-012). */
export interface GuestExplore {
  city: string | null;
  /** Who may earn a commission (OQ-08: Guidesk only during the pilot). */
  disclosure: "guidesk";
  tips: GuestRecommendation[];
  categories: { category: ExploreCategory; experiences: ExperienceCard[] }[];
}

const settingsValues = z
  .object({
    experiencesEnabled: z.boolean(),
    hiddenCategories: z
      .array(z.enum(EXPLORE_CATEGORY_VALUES))
      .max(EXPLORE_CATEGORY_VALUES.length)
      .refine((values) => new Set(values).size === values.length, "No duplicates"),
  })
  .strict();

export const workspaceExploreBodySchema = settingsValues
  .extend({ version: z.int().min(0) })
  .strict();
export type WorkspaceExploreBody = z.infer<typeof workspaceExploreBodySchema>;

export const propertyExploreBodySchema = z
  .object({
    version: z.int().min(0),
    followsDefault: z.boolean(),
    own: settingsValues,
    hiddenExperiences: z
      .array(refSchema)
      .max(200)
      .refine((values) => new Set(values).size === values.length, "No duplicates"),
  })
  .strict();
export type PropertyExploreBody = z.infer<typeof propertyExploreBodySchema>;

export interface ExploreSettingsValues {
  experiencesEnabled: boolean;
  hiddenCategories: ExploreCategory[];
}

/** `GET /explore` and `PUT /explore`: the workspace default. */
export interface WorkspaceExplore extends ExploreSettingsValues {
  version: number;
}

export interface PropertyExploreExperience extends ExperienceCard {
  hidden: boolean;
  categoryHidden: boolean;
  /** True when guests see it (after hiding and the limit of 12). */
  shown: boolean;
}

/** `GET /properties/{propertyId}/explore` (FR-021 to FR-025). */
export interface PropertyExplore {
  version: number;
  followsDefault: boolean;
  own: ExploreSettingsValues;
  effective: ExploreSettingsValues;
  hiddenExperiences: string[];
  destination: { city: string | null; available: boolean };
  visible: boolean;
  tips: GuestRecommendation[];
  experiences: PropertyExploreExperience[];
}
