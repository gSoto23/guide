import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { exploreSettings, guide, property } from "@guidesk/db";
import { selectExperiences, type ExperienceCategory } from "@guidesk/domain";
import type {
  GuestRecommendation,
  PropertyExplore,
  PropertyExploreBody,
  WorkspaceExplore,
  WorkspaceExploreBody,
} from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { PublishService } from "../guides/publish.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { ExploreSelection } from "./explore-selection.js";

export interface ExploreCaller {
  userId: string;
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);

/**
 * Explore settings for members (feature 009 US2, FR-021 to FR-025, research R10): the workspace
 * default and each property's own settings, with versions; changes are logged with flags only.
 * Guests see changes within the guide's cache time, without republishing.
 */
@Injectable()
export class ExploreService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
    private readonly selection: ExploreSelection,
    private readonly publish: PublishService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  async getWorkspace(workspaceId: string): Promise<WorkspaceExplore> {
    const state = await this.selection.settings(this.tx, workspaceId, null);
    return {
      version: state.workspace?.version ?? 0,
      experiencesEnabled: state.workspace?.experiencesEnabled ?? true,
      hiddenCategories: (state.workspace?.hiddenCategories ?? []) as ExperienceCategory[],
    };
  }

  async setWorkspace(
    caller: ExploreCaller,
    workspaceId: string,
    body: WorkspaceExploreBody,
  ): Promise<WorkspaceExplore> {
    const current = await this.getWorkspace(workspaceId);
    if (current.version !== body.version) throw new ApiProblem(409, "settings_changed");
    const changed = {
      ...(current.experiencesEnabled !== body.experiencesEnabled
        ? { experiencesEnabled: true }
        : {}),
      ...(!sameList(current.hiddenCategories, body.hiddenCategories)
        ? { hiddenCategories: true }
        : {}),
    };
    await this.save(caller, workspaceId, null, body.version, {
      experiencesEnabled: body.experiencesEnabled,
      hiddenCategories: body.hiddenCategories,
    });
    await this.log(caller, workspaceId, null, changed);
    return this.getWorkspace(workspaceId);
  }

  private async propertyOf(workspaceId: string, propertyId: string) {
    const [row] = await this.tx
      .select({ id: property.id })
      .from(property)
      .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "property", propertyId);
    }
  }

  /** The published guide's recommendations, or none when the guide isn't published. */
  private async tips(
    workspaceId: string,
    propertyId: string,
    language: "es" | "en",
  ): Promise<GuestRecommendation[]> {
    const [published] = await this.tx
      .select({ id: guide.publishedVersionId })
      .from(guide)
      .where(and(eq(guide.propertyId, propertyId), eq(guide.workspaceId, workspaceId)))
      .limit(1);
    if (!published?.id) return [];
    const preview = await this.publish.preview(workspaceId, propertyId, {
      source: "published",
      lang: language,
    });
    return preview.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        item.kind === "recommendation" && item.recommendation
          ? [
              {
                name: item.recommendation.name,
                category: item.recommendation.category,
                url: item.recommendation.url ?? null,
                address: item.recommendation.address ?? null,
                benefit:
                  item.recommendation.benefit !== undefined &&
                  item.recommendation.benefit !== "none",
                benefitKind: item.recommendation.benefit ?? null,
                personalTip: item.recommendation.personalTip ?? false,
              },
            ]
          : [],
      ),
    );
  }

  async getProperty(
    workspaceId: string,
    propertyId: string,
    language: "es" | "en",
  ): Promise<PropertyExplore> {
    await this.propertyOf(workspaceId, propertyId);
    const state = await this.selection.forProperty(this.tx, workspaceId, propertyId, language);
    const tips = await this.tips(workspaceId, propertyId, language);
    const shown = new Set(state.selected.map((candidate) => candidate.ref));
    const hiddenRefs = new Set(state.effective.hiddenExperiences);
    const hiddenCategories = new Set<string>(state.effective.hiddenCategories);
    // Every current experience, ranked as guests would see them when nothing is hidden.
    const ranked = selectExperiences(state.candidates, {
      experiencesEnabled: true,
      hiddenCategories: [],
      hiddenExperiences: [],
    });
    const rest = state.candidates.filter((candidate) => !ranked.includes(candidate));
    return {
      version: state.property?.version ?? 0,
      followsDefault: state.property?.followsDefault ?? true,
      own: {
        experiencesEnabled: state.property?.experiencesEnabled ?? true,
        hiddenCategories: state.property?.hiddenCategories ?? [],
      },
      effective: {
        experiencesEnabled: state.effective.experiencesEnabled,
        hiddenCategories: state.effective.hiddenCategories,
      },
      hiddenExperiences: state.effective.hiddenExperiences,
      destination: { city: state.city, available: state.candidates.length > 0 },
      visible: tips.length > 0 || state.selected.length > 0,
      tips,
      experiences: [...ranked, ...rest].map((candidate) => ({
        ...candidate.card,
        hidden: hiddenRefs.has(candidate.ref),
        categoryHidden: hiddenCategories.has(candidate.category),
        shown: shown.has(candidate.ref),
      })),
    };
  }

  async setProperty(
    caller: ExploreCaller,
    workspaceId: string,
    propertyId: string,
    body: PropertyExploreBody,
    language: "es" | "en",
  ): Promise<PropertyExplore> {
    await this.propertyOf(workspaceId, propertyId);
    const state = await this.selection.settings(this.tx, workspaceId, propertyId);
    const current = state.property;
    if ((current?.version ?? 0) !== body.version) throw new ApiProblem(409, "settings_changed");
    const changed = {
      ...((current?.followsDefault ?? true) !== body.followsDefault ? { follows: true } : {}),
      ...((current?.experiencesEnabled ?? true) !== body.own.experiencesEnabled
        ? { experiencesEnabled: true }
        : {}),
      ...(!sameList(current?.hiddenCategories ?? [], body.own.hiddenCategories)
        ? { hiddenCategories: true }
        : {}),
      ...(!sameList(current?.hiddenExperiences ?? [], body.hiddenExperiences)
        ? { hiddenExperiences: true }
        : {}),
    };
    await this.save(caller, workspaceId, propertyId, body.version, {
      followsDefault: body.followsDefault,
      experiencesEnabled: body.own.experiencesEnabled,
      hiddenCategories: body.own.hiddenCategories,
      hiddenExperiences: body.hiddenExperiences,
    });
    await this.log(caller, workspaceId, propertyId, changed);
    return this.getProperty(workspaceId, propertyId, language);
  }

  private async save(
    caller: ExploreCaller,
    workspaceId: string,
    propertyId: string | null,
    version: number,
    values: {
      followsDefault?: boolean;
      experiencesEnabled: boolean;
      hiddenCategories: string[];
      hiddenExperiences?: string[];
    },
  ): Promise<void> {
    const scope = propertyId
      ? eq(exploreSettings.propertyId, propertyId)
      : isNull(exploreSettings.propertyId);
    const updated = await this.tx
      .update(exploreSettings)
      .set({
        ...values,
        version: sql`${exploreSettings.version} + 1`,
        updatedBy: caller.userId,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(exploreSettings.workspaceId, workspaceId),
          scope,
          eq(exploreSettings.version, version),
        ),
      )
      .returning({ id: exploreSettings.id });
    if (updated.length > 0) return;
    if (version !== 0) throw new ApiProblem(409, "settings_changed");
    const [inserted] = await this.tx
      .insert(exploreSettings)
      .values({ workspaceId, propertyId, ...values, version: 1, updatedBy: caller.userId })
      .onConflictDoNothing()
      .returning({ id: exploreSettings.id });
    if (!inserted) throw new ApiProblem(409, "settings_changed");
  }

  private async log(
    caller: ExploreCaller,
    workspaceId: string,
    propertyId: string | null,
    changed: Record<string, boolean>,
  ): Promise<void> {
    if (Object.keys(changed).length === 0) return;
    await this.securityLog.record({
      type: "explore.settings_changed",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: propertyId ? "property" : "workspace",
      targetId: propertyId ?? workspaceId,
      metadata: {
        scope: propertyId ? "property" : "workspace",
        ...(propertyId ? { propertyId } : {}),
        ...changed,
      },
    });
  }
}
