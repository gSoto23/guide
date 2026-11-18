import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { experienceClickDaily } from "@guidesk/db";
import { EXPERIENCE_REF, groupByCategory, partnerRedirectTarget, todayIn } from "@guidesk/domain";
import type { GuestExplore, GuestGuide, GuestRecommendation } from "@guidesk/contracts";
import { RateLimitService } from "../common/rate-limit.service.js";
import { ExploreSelection } from "../explore/explore-selection.js";
import { GuestContext } from "./guest-context.js";
import { GuestGuideService } from "./guest-guide.service.js";
import { AUTOMATED } from "./opens.service.js";

/** Clicks counted per network address per hour; more are ignored silently (research R8). */
export const CLICKS_PER_HOUR = 60;

/** The host's tips: the published guide's recommendations, in guide order (FR-002). */
export function tipsOf(guide: GuestGuide): GuestRecommendation[] {
  return guide.sections.flatMap((section) =>
    section.items.flatMap((item) => (item.recommendation ? [item.recommendation] : [])),
  );
}

/**
 * Explore for guests (feature 009 US1, US3; research R7 to R9): the tips and the selected
 * experiences, and the click redirect, which leads only to the stored partner page of an experience
 * the property shows, on the partner's hosts. Nothing a caller sends can choose the destination.
 */
@Injectable()
export class GuestExploreService {
  constructor(
    private readonly context: GuestContext,
    private readonly guides: GuestGuideService,
    private readonly selection: ExploreSelection,
    private readonly rateLimit: RateLimitService,
  ) {}

  async explore(publicId: string, lang: "es" | "en" | undefined): Promise<GuestExplore> {
    const guide = await this.guides.guide(publicId, lang);
    const target = await this.context.byPublicId(publicId);
    const state = await this.selection.forProperty(
      this.context.db,
      target.workspaceId,
      target.propertyId,
      guide.language,
    );
    return {
      city: state.city,
      disclosure: "guidesk",
      tips: tipsOf(guide),
      categories: groupByCategory(state.selected.map((candidate) => candidate.card)),
    };
  }

  /** Where a tap on "Book on {partner}" goes: the partner page, or back to Explore. */
  async redirect(
    publicId: string,
    ref: string,
    lang: "es" | "en",
    count: boolean,
    userAgent: string | undefined,
    ipKey: string,
  ): Promise<string> {
    let target;
    try {
      target = await this.context.byPublicId(publicId);
    } catch {
      return "/";
    }
    const back = `/g/${target.publicId}/${lang}/explore`;
    if (!EXPERIENCE_REF.test(ref)) return back;
    const state = await this.selection.forProperty(
      this.context.db,
      target.workspaceId,
      target.propertyId,
      lang,
    );
    const hit = state.selected.find((candidate) => candidate.ref === ref);
    if (!hit) return back;
    const location = partnerRedirectTarget(
      hit.partner,
      hit.partnerUrl,
      this.selection.civitatisAffiliateId,
    );
    if (!location) return back;
    if (count && userAgent && !AUTOMATED.test(userAgent)) {
      const limit = await this.rateLimit.consume(`guest-clicks:ip:${ipKey}`, CLICKS_PER_HOUR, 3600);
      if (limit.allowed) {
        await this.context.db
          .insert(experienceClickDaily)
          .values({
            workspaceId: target.workspaceId,
            propertyId: target.propertyId,
            day: todayIn(target.timeZone),
            partner: hit.partner,
            ref: hit.ref,
            clicks: 1,
          })
          .onConflictDoUpdate({
            target: [
              experienceClickDaily.propertyId,
              experienceClickDaily.day,
              experienceClickDaily.ref,
            ],
            set: { clicks: sql`${experienceClickDaily.clicks} + 1` },
          });
      }
    }
    return location;
  }
}
