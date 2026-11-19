import { Inject, Injectable } from "@nestjs/common";
import {
  consumeDailyCount,
  dailyCount,
  derivedBasis,
  mediaBytesUsed,
  workspaceLimitInputs,
  type DbHandle,
} from "@guidesk/db";
import {
  guideAiDailyLimit,
  guideAiLimitKey,
  guideAiLimitResetsAt,
  mediaStorageLimitBytes,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";

export interface GuideLimits {
  ai: { limit: number; usedToday: number; resetsAt: string };
  media: { limitBytes: number; usedBytes: number };
}

/**
 * The guide builder's limits (feature 003 FR-064, FR-065, research R6, R9): the daily AI count per
 * workspace, taken before any AI work is queued, and the media storage limit.
 */
@Injectable()
export class GuideLimitsService {
  constructor(
    private readonly requestDb: RequestDb,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  private async workspaceLimits(workspaceId: string) {
    const inputs = await workspaceLimitInputs(this.requestDb.current(), workspaceId);
    const basis = inputs ? derivedBasis(inputs) : 2;
    return {
      ai: guideAiDailyLimit(basis, inputs?.guideAiDailyLimit),
      mediaBytes: mediaStorageLimitBytes(basis, inputs?.mediaStorageLimitMb),
    };
  }

  async limitsOf(workspaceId: string): Promise<GuideLimits> {
    const now = new Date();
    const limits = await this.workspaceLimits(workspaceId);
    return {
      ai: {
        limit: limits.ai,
        usedToday: await dailyCount(this.handle.db, guideAiLimitKey(workspaceId, now)),
        resetsAt: guideAiLimitResetsAt(now).toISOString(),
      },
      media: {
        limitBytes: limits.mediaBytes,
        usedBytes: await mediaBytesUsed(this.requestDb.current(), workspaceId),
      },
    };
  }

  /** Takes one AI request from today's limit, or refuses with the reset time (AC-SEC-012). */
  async consumeAi(workspaceId: string): Promise<void> {
    const now = new Date();
    const { ai } = await this.workspaceLimits(workspaceId);
    const result = await consumeDailyCount(this.handle.db, guideAiLimitKey(workspaceId, now), ai);
    if (!result.allowed) {
      const resetsAt = guideAiLimitResetsAt(now);
      throw new ApiProblem(429, "ai_limit_reached", undefined, {
        details: { limit: ai, resetsAt: resetsAt.toISOString() },
        retryAfterSeconds: Math.ceil((resetsAt.getTime() - now.getTime()) / 1000),
      });
    }
  }

  /** Refuses media that would pass the workspace's storage limit (FR-065). */
  async assertMediaRoom(workspaceId: string, extraBytes: number): Promise<void> {
    const { mediaBytes } = await this.workspaceLimits(workspaceId);
    const used = await mediaBytesUsed(this.requestDb.current(), workspaceId);
    if (used + extraBytes > mediaBytes) {
      throw new ApiProblem(422, "storage_limit_reached", undefined, {
        details: { limitBytes: mediaBytes, usedBytes: used },
      });
    }
  }
}
