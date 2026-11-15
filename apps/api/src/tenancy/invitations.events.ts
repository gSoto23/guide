import { Injectable } from "@nestjs/common";
import type { SecurityEventType } from "@guidesk/domain";
import { SecurityLogService } from "../security-log/security-log.service.js";

type InvitationEvent = Extract<
  SecurityEventType,
  | "invitation.sent"
  | "invitation.resent"
  | "invitation.revoked"
  | "invitation.accepted"
  | "invitation.accept_denied"
>;

/**
 * Security events for invitations (FR-030, T079). `invitation.accepted` is written by the
 * accept_invitation() function in the same transaction as the membership.
 */
@Injectable()
export class InvitationEvents {
  constructor(private readonly securityLog: SecurityLogService) {}

  record(
    type: InvitationEvent,
    details: {
      actorUserId: string;
      workspaceId: string | null;
      invitationId: string | null;
      role?: string;
      reason?: string;
    },
  ): Promise<void> {
    return this.securityLog.record({
      type,
      outcome: type === "invitation.accept_denied" ? "denied" : "success",
      actorUserId: details.actorUserId,
      workspaceId: details.workspaceId,
      targetType: "invitation",
      targetId: details.invitationId,
      metadata: {
        ...(details.role ? { role: details.role } : {}),
        ...(details.reason ? { reason: details.reason } : {}),
      },
    });
  }
}
