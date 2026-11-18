import { Injectable } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { guide, guideVersion, restrictedValue } from "@guidesk/db";
import { lockState } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { RevealService } from "../locked-fields/reveal.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { GuestContext, unavailable } from "./guest-context.js";
import { GuestSessions } from "./sessions.service.js";

/** Values shown per device session per hour (FR-032). */
export const GUEST_REVEALS_PER_HOUR = 30;

/**
 * Showing a locked value to a guest (feature 004 FR-029 to FR-032, research R7): a session inside
 * its stay window, verified when the property asks for a code, under the per-session limit, for a
 * field the published guide references. Each value shown is recorded for the host's reveal
 * history; the value itself comes only from feature 003's reveal service.
 */
@Injectable()
export class GuestReveals {
  constructor(
    private readonly context: GuestContext,
    private readonly sessions: GuestSessions,
    private readonly reveals: RevealService,
    private readonly rateLimit: RateLimitService,
    private readonly securityLog: SecurityLogService,
  ) {}

  async reveal(
    publicId: string,
    fieldId: string,
    cookieHeader: string | undefined,
  ): Promise<string> {
    const target = await this.context.byPublicId(publicId);
    const device = await this.sessions.device(target, cookieHeader);
    if (!device) throw new ApiProblem(401, "no_session");
    const state = lockState(device.context, new Date());
    if (state.state !== "inside") {
      throw new ApiProblem(409, "not_in_window", undefined, {
        details: {
          state: state.state,
          ...(state.window && state.state === "before"
            ? { opensAt: state.window.opensAt.toISOString() }
            : {}),
        },
      });
    }
    if (target.requireConfirmationCode && !device.verified) {
      throw new ApiProblem(409, "verification_required");
    }
    const [published] = await this.context.db
      .select({ id: guideVersion.id })
      .from(guide)
      .innerJoin(guideVersion, eq(guideVersion.id, guide.publishedVersionId))
      .where(
        and(
          eq(guide.id, target.guideId),
          sql`jsonb_path_exists(${guideVersion.snapshot}, 'lax $.** ? (@.type == "lockedField" && @.attrs.fieldId == $id)', jsonb_build_object('id', ${fieldId}::text))`,
        ),
      )
      .limit(1);
    const [field] = await this.context.db
      .select({ kind: restrictedValue.kind })
      .from(restrictedValue)
      .where(
        and(
          eq(restrictedValue.id, fieldId),
          eq(restrictedValue.workspaceId, target.workspaceId),
          eq(restrictedValue.propertyId, target.propertyId),
        ),
      )
      .limit(1);
    if (!published || !field) throw unavailable();
    const limit = await this.rateLimit.consume(
      `guest-reveal:session:${device.sessionId}`,
      GUEST_REVEALS_PER_HOUR,
      3600,
    );
    if (!limit.allowed) {
      throw new ApiProblem(429, "rate_limited", undefined, {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    const value = await this.reveals.valueOf(target.workspaceId, target.propertyId, fieldId);
    if (value === null) throw unavailable();
    await this.securityLog.record({
      type: "restricted_value.guest_revealed",
      outcome: "success",
      workspaceId: target.workspaceId,
      targetType: "restricted_value",
      targetId: fieldId,
      metadata: {
        propertyId: target.propertyId,
        fieldId,
        kind: field.kind,
        stayId: device.stayId,
        sessionId: device.sessionId,
      },
    });
    return value;
  }
}
