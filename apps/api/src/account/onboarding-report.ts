import { Inject, Injectable } from "@nestjs/common";
import { count } from "drizzle-orm";
import { onboardingProfile, type DbHandle } from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";

export interface OnboardingReport {
  byPropertiesBucket: Record<string, number>;
  byPms: Record<string, number>;
  byPath: Record<string, number>;
  total: number;
}

/**
 * Aggregate onboarding answers for Guidesk (FR-006, T046), used to prioritize PMS importers.
 * Counts only: no user IDs, emails, or countries per person leave this report (SEC-20).
 * Runs in the system context; exposed later through the back-office (feature 015).
 */
@Injectable()
export class OnboardingReportService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async aggregate(): Promise<OnboardingReport> {
    const db = this.handle.db;
    const group = async (
      column:
        | typeof onboardingProfile.pms
        | typeof onboardingProfile.propertiesBucket
        | typeof onboardingProfile.path,
    ) => {
      const rows = await db
        .select({ key: column, n: count() })
        .from(onboardingProfile)
        .groupBy(column);
      return Object.fromEntries(rows.map((row) => [row.key ?? "unanswered", Number(row.n)]));
    };
    const [byPropertiesBucket, byPms, byPath, totalRows] = await Promise.all([
      group(onboardingProfile.propertiesBucket),
      group(onboardingProfile.pms),
      group(onboardingProfile.path),
      db.select({ n: count() }).from(onboardingProfile),
    ]);
    return { byPropertiesBucket, byPms, byPath, total: Number(totalRows[0]?.n ?? 0) };
  }
}
