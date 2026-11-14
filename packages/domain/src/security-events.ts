/** Security event catalog (spec 001 FR-030, data model §4). */
export const SECURITY_EVENT_TYPES = [
  "signin.succeeded",
  "signin.failed",
  "signin.locked",
  "signin.new_device",
  "passkey.added",
  "passkey.removed",
  "mfa.enrolled",
  "mfa.removed",
  "recovery_code.used",
  "step_up.succeeded",
  "step_up.failed",
  "session.revoked",
  "sessions.revoked_all",
  "email.change_requested",
  "email.changed",
  "account.export_downloaded",
  "account.deletion_scheduled",
  "account.deleted",
  "invitation.sent",
  "invitation.resent",
  "invitation.accepted",
  "invitation.revoked",
  "invitation.accept_denied",
  "member.role_changed",
  "member.removed",
  "member.left",
  "ownership.transferred",
  "workspace.created",
  "workspace.deletion_scheduled",
  "workspace.restored",
  "workspace.purged",
  "access.cross_workspace_denied",
  "restricted_value.reveal_denied",
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];
export type SecurityEventOutcome = "success" | "failure" | "denied";

export interface SecurityEventInput {
  type: SecurityEventType;
  outcome: SecurityEventOutcome;
  actorUserId?: string | null;
  workspaceId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ipHash?: string | null;
  approxLocation?: string | null;
  userAgentFamily?: string | null;
  /** Non-secret details only. Never codes, tokens, or passwords. */
  metadata?: Record<string, unknown>;
}

const FORBIDDEN_METADATA_KEYS = /(code|otp|token|secret|password|cookie)/i;

/** Rejects metadata keys that suggest secrets, so they never reach the log (SEC-06). */
export function assertSafeMetadata(metadata: Record<string, unknown> | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (FORBIDDEN_METADATA_KEYS.test(key)) {
      throw new Error(`Security event metadata must not contain secrets (key "${key}")`);
    }
  }
}
