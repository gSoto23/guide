import { describeError } from "@guidesk/observability";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { assertSafeMetadata, type SecurityEventInput } from "@guidesk/domain";
import { securityEvent, type DbHandle } from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";

/**
 * Writes the append-only security log (FR-030, SEC-16, T022). Uses the owner connection, so
 * events are recorded even outside a request transaction (for example in auth hooks).
 */
@Injectable()
export class SecurityLogService {
  private readonly logger = new Logger("SecurityLog");

  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async record(event: SecurityEventInput): Promise<void> {
    assertSafeMetadata(event.metadata, event.type);
    try {
      await this.handle.db.insert(securityEvent).values({
        type: event.type,
        outcome: event.outcome,
        actorUserId: event.actorUserId ?? null,
        workspaceId: event.workspaceId ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        ipHash: event.ipHash ?? null,
        approxLocation: event.approxLocation ?? null,
        userAgentFamily: event.userAgentFamily ?? null,
        metadata: event.metadata ?? {},
      });
    } catch (error) {
      // A failed audit write must be visible in error tracking but must not break the request.
      this.logger.error(`Failed to record security event ${event.type}`, describeError(error));
    }
  }
}
