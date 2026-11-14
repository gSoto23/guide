import { Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { derivePath, validateOnboarding, type OnboardingAnswers } from "@guidesk/domain";
import { onboardingProfile } from "@guidesk/db";
import type { OnboardingBody, OnboardingResponse } from "@guidesk/contracts";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";

const EMPTY: OnboardingResponse = {
  propertiesBucket: null,
  pms: null,
  pmsOther: null,
  country: null,
  skipped: false,
  path: "individual",
  answeredAt: null,
};

/** Onboarding answers (FR-005, FR-006, T042). Stored under RLS: each user sees only their own. */
@Injectable()
export class OnboardingService {
  constructor(private readonly requestDb: RequestDb) {}

  async get(userId: string): Promise<OnboardingResponse> {
    const [row] = await this.requestDb
      .current()
      .select()
      .from(onboardingProfile)
      .where(eq(onboardingProfile.userId, userId))
      .limit(1);
    if (!row) {
      return EMPTY;
    }
    return {
      propertiesBucket: row.propertiesBucket ?? null,
      pms: (row.pms as OnboardingResponse["pms"]) ?? null,
      pmsOther: row.pmsOther ?? null,
      country: row.country ?? null,
      skipped: row.skipped,
      path: row.path,
      answeredAt: row.answeredAt ? row.answeredAt.toISOString() : null,
    };
  }

  /** Replaces the answers (PUT semantics). Skipping clears every answer. */
  async put(userId: string, body: OnboardingBody): Promise<OnboardingResponse> {
    const skipped = body.skipped === true;
    const answers: OnboardingAnswers = skipped
      ? { propertiesBucket: null, pms: null, pmsOther: null, country: null }
      : {
          propertiesBucket: body.propertiesBucket ?? null,
          pms: body.pms ?? null,
          pmsOther: body.pmsOther ?? null,
          country: body.country ?? null,
        };
    const errors = validateOnboarding(answers);
    if (errors.length > 0) {
      throw new ApiProblem(422, "validation_failed", errors.join("; "));
    }
    const answered = Object.values(answers).some((value) => value !== null);
    const values = {
      userId,
      ...answers,
      path: derivePath(answers),
      skipped,
      answeredAt: answered ? new Date() : null,
    };
    await this.requestDb
      .current()
      .insert(onboardingProfile)
      .values(values)
      .onConflictDoUpdate({
        target: onboardingProfile.userId,
        set: { ...values, updatedAt: sql`now()` },
      });
    return this.get(userId);
  }
}
