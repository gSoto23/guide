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
  // Feature 003 (data model §6, research R19).
  "restricted_value.added",
  "restricted_value.changed",
  "restricted_value.deleted",
  "restricted_value.revealed",
  "restricted_value.reveal_limited",
  "restricted_value.made_public",
  "restricted_value.made_locked",
  "guide.published",
  "guide.unpublished",
  "guide.version_restored",
  "shared_block.published",
  "shared_block.deleted",
  // Feature 004 (data model §5).
  "guide.property_link_regenerated",
  "guide.stay_link_copied",
  "guide.stay_link_regenerated",
  "guide.stay_link_revoked",
  "guide.confirmation_changed",
  "guide.verification_locked",
  "restricted_value.guest_revealed",
  "restricted_value.exported",
  // Feature 005 (data model §4).
  "assistant.autonomy_changed",
  "conversation.replied",
  // Feature 007 (research R10).
  "assistant.settings_changed",
  // Feature 006 (data model, FR-006, FR-021).
  "conversation.taken_over",
  "conversation.handed_back",
  "conversation.draft_rejected",
  "conversation.marked_done",
  "conversation.reopened",
  "push.subscribed",
  "push.unsubscribed",
  // Feature 009 (data model).
  "explore.settings_changed",
  // Feature 008 (data model).
  "extras.changed",
  "service_request.answered",
  // Feature 011 (data model): changed by Guidesk's founder tool, so there is no actor.
  "workspace.plan_changed",
  // Feature 013 (data model).
  "payment.refunded",
  "payment.disputed",
  "payment.event_refused",
  "payouts.onboarding_started",
  "payouts.status_changed",
  // Feature 014: the founder's demo command made a demo workspace (actor: its owner).
  "workspace.demo_seeded",
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
/** Locked-field events name the field and its kind, never the value (feature 003 R19). */
const LOCKED_FIELD = ["propertyId", "fieldId", "kind"];
const GUIDE_VERSION = ["propertyId", "versionNumber"];
const SHARED_BLOCK = ["sharedBlockId", "sectionKind", "guidesUpdated"];
/** Stay link events name the property and stay, never the link, token, or code (feature 004). */
const STAY_LINK = ["propertyId", "stayId"];

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
  "restricted_value.added": LOCKED_FIELD,
  "restricted_value.changed": LOCKED_FIELD,
  "restricted_value.deleted": LOCKED_FIELD,
  "restricted_value.revealed": LOCKED_FIELD,
  "restricted_value.reveal_limited": ["propertyId", "fieldId", "kind", "reveals"],
  "restricted_value.made_public": LOCKED_FIELD,
  "restricted_value.made_locked": LOCKED_FIELD,
  "guide.published": GUIDE_VERSION,
  "guide.unpublished": GUIDE_VERSION,
  "guide.version_restored": GUIDE_VERSION,
  "shared_block.published": SHARED_BLOCK,
  "shared_block.deleted": SHARED_BLOCK,
  "guide.property_link_regenerated": ["propertyId"],
  "guide.stay_link_copied": STAY_LINK,
  "guide.stay_link_regenerated": STAY_LINK,
  "guide.stay_link_revoked": STAY_LINK,
  "guide.confirmation_changed": ["propertyId", "required"],
  "guide.verification_locked": ["propertyId", "stayId", "lockedMinutes", "lockouts"],
  // Guest reveals carry no actor, address, or device detail (feature 004 FR-032, SEC-20).
  "restricted_value.guest_revealed": [...LOCKED_FIELD, "stayId", "sessionId"],
  "restricted_value.exported": ["propertyId", "stayId", "fields", "language"],
  "assistant.autonomy_changed": ["propertyId", "autonomy"],
  "conversation.replied": ["propertyId", "conversationId", "fromDraft", "edited"],
  // One `true` flag per changed group, never the instruction text (feature 007 FR-015).
  "assistant.settings_changed": [
    "scope",
    "propertyId",
    "autonomy",
    "tone",
    "quietHours",
    "contacts",
    "instructions",
    "follows",
  ],
  "conversation.taken_over": ["propertyId", "conversationId"],
  "conversation.handed_back": ["propertyId", "conversationId"],
  "conversation.draft_rejected": ["propertyId", "conversationId"],
  "conversation.marked_done": ["propertyId", "conversationId"],
  "conversation.reopened": ["propertyId", "conversationId"],
  "push.subscribed": ["device"],
  "push.unsubscribed": ["device"],
  // One `true` flag per changed field, never the values (feature 009 data model).
  "explore.settings_changed": [
    "scope",
    "propertyId",
    "experiencesEnabled",
    "hiddenCategories",
    "hiddenExperiences",
    "follows",
  ],
  "extras.changed": ["propertyId", "action", "count"],
  "service_request.answered": ["propertyId", "requestId", "status"],
  // The plans and custom limits (a number or "plan"); the founder's note stays off the log.
  "workspace.plan_changed": ["from", "to", "properties", "seats", "aiReplies", "feeBps"],
  // Amounts and IDs only; never card data or the guest's details (feature 013 SEC-20).
  "payment.refunded": ["orderId", "amountMinor", "currency", "full"],
  "payment.disputed": ["orderId"],
  "payment.event_refused": ["provider", "reason"],
  "payouts.onboarding_started": ["provider"],
  "payouts.status_changed": ["provider", "status"],
  // Counts only; never guest names, codes, or links (feature 014).
  "workspace.demo_seeded": ["properties", "stays"],
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
