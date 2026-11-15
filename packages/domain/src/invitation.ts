/** Invitation rules (spec 001 FR-018 to FR-021, data model §5, research R8). */

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** Invitation emails per workspace per hour, and resends per invitation per day (R8). */
export const INVITES_PER_WORKSPACE_PER_HOUR = 20;
export const RESENDS_PER_INVITATION_PER_DAY = 3;
/** Invitation emails to one address per day, across all workspaces (AC-SEC-008, T103). */
export const INVITES_PER_RECIPIENT_PER_DAY = 5;

export interface InvitationState {
  status: InvitationStatus;
  expiresAt: Date;
}

/** Emails are compared trimmed and lowercased (FR-003). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function invitationExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + INVITATION_TTL_MS);
}

/** A pending invitation past its expiry counts as expired, even before the daily job marks it. */
export function effectiveStatus(
  invitation: InvitationState,
  now: Date = new Date(),
): InvitationStatus {
  if (invitation.status === "pending" && invitation.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  return invitation.status;
}

/** Only a pending, unexpired invitation can be accepted, resent, or revoked (state machine). */
export function isOpen(invitation: InvitationState, now: Date = new Date()): boolean {
  return effectiveStatus(invitation, now) === "pending";
}

export type ResendDecision = "ok" | "gone" | "rate_limited";

/** Resending keeps the original expiry (data model §5) and is limited per day (R8). */
export function resendDecision(
  invitation: InvitationState,
  resendsToday: number,
  now: Date = new Date(),
): ResendDecision {
  if (!isOpen(invitation, now)) return "gone";
  if (resendsToday >= RESENDS_PER_INVITATION_PER_DAY) return "rate_limited";
  return "ok";
}
