/**
 * Partner experiences near a property (feature 009 research R1, R2). Only background jobs call a
 * partner; guest requests read what the worker stored (FR-017). Partner text is untrusted plain text.
 */
export type ExperienceLanguage = "es" | "en";

export interface PartnerExperience {
  productId: string;
  title: string;
  description: string;
  durationMinutes: number | null;
  priceFrom: number | null;
  currency: string | null;
  rating: number | null;
  reviewCount: number | null;
  image: { url: string; width: number; height: number } | null;
  /** The partner page with Guidesk's affiliate tracking, HTTPS on the partner's hosts. */
  partnerUrl: string;
  tagIds: number[];
  machineTranslated: boolean;
}

export interface PartnerDestination {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  /** Dotted ancestor path, for example `9.21.794` (country first). */
  lookupId: string;
}

export interface PartnerTag {
  id: number;
  parentIds: number[];
  /** English name, used for the category mapping (research R6). */
  name: string;
}

export interface ExperienceSearch {
  destinationId: string;
  language: ExperienceLanguage;
  currency: string;
  count: number;
}

export type PartnerErrorCode = "timeout" | "http_429" | "http_4xx" | "http_5xx" | "invalid";

/** Carries an error code only, never a response body (data model `experience_refresh.last_error`). */
export class ExperiencePartnerError extends Error {
  constructor(readonly code: PartnerErrorCode) {
    super(`partner request failed: ${code}`);
    this.name = "ExperiencePartnerError";
  }
}

export interface ExperiencePartnerPort {
  readonly partner: "viator";
  search(input: ExperienceSearch, options?: { signal?: AbortSignal }): Promise<PartnerExperience[]>;
  destinations(options?: { signal?: AbortSignal }): Promise<PartnerDestination[]>;
  tags(options?: { signal?: AbortSignal }): Promise<PartnerTag[]>;
}
