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
  "account.deletion_cancelled",
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
  "access.role_denied",
  "restricted_value.reveal_denied",
  // Feature 002 (data model §5).
  "integration.connected",
  "integration.disconnected",
  "import.started",
  "import.finished",
  "calendar_feed.added",
  "calendar_feed.changed",
  "calendar_feed.removed",
  "stay.added_manually",
  "stay.changed_manually",
  "stay.cancelled_manually",
  "stay.guest_name_removed",
  "property.removed",
  "property.restored",
  "property.purged",
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

const IMPORT_COUNTS = ["kind", "total", "created", "updated", "needsDetails", "failed", "skipped"];
const STAY_DATES = ["stayId", "checkInDate", "checkoutDate"];

/**
 * Metadata allowed per feature 002 event (data model §5, T015). Feed events carry the channel,
 * never the link; stay events carry the stay and its dates, never the guest name; import events
 * carry counts, never row values; disconnects record whether the provider revoked the credential.
 * Events not listed here keep the general rule only.
 */
const METADATA_ALLOWLIST: Partial<Record<SecurityEventType, readonly string[]>> = {
  "integration.connected": ["provider"],
  "integration.disconnected": ["provider", "providerRevoked"],
  "import.started": IMPORT_COUNTS,
  "import.finished": IMPORT_COUNTS,
  "calendar_feed.added": ["channel"],
  "calendar_feed.changed": ["channel"],
  "calendar_feed.removed": ["channel"],
  "stay.added_manually": STAY_DATES,
  "stay.changed_manually": STAY_DATES,
  "stay.cancelled_manually": STAY_DATES,
  "stay.guest_name_removed": STAY_DATES,
  "property.removed": [],
  "property.restored": [],
  "property.purged": [],
};

/** Short labels, numbers, booleans, and calendar dates; nothing that could carry free text. */
function isSafeValue(value: unknown): boolean {
  if (typeof value === "number" || typeof value === "boolean") return true;
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{0,40}$/.test(value);
}

/**
 * Rejects metadata keys that suggest secrets, so they never reach the log (SEC-06). For feature
 * 002 events, only the allowlisted keys are accepted, with short plain values.
 */
export function assertSafeMetadata(
  metadata: Record<string, unknown> | undefined,
  type?: SecurityEventType,
): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (FORBIDDEN_METADATA_KEYS.test(key)) {
      throw new Error(`Security event metadata must not contain secrets (key "${key}")`);
    }
  }
  const allowed = type ? METADATA_ALLOWLIST[type] : undefined;
  if (!allowed) return;
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (!allowed.includes(key)) {
      throw new Error(`Security event ${type} must not carry metadata "${key}"`);
    }
    if (!isSafeValue(value)) {
      throw new Error(`Security event ${type} metadata "${key}" must be a short plain value`);
    }
  }
}
