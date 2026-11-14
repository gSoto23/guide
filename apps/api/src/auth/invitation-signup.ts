/** Header the portal sends while a person signs up from an invitation link (FR-020). */
export const INVITATION_HEADER = "x-guidesk-invitation";

/**
 * A sign-up that comes from an invitation joins the inviting workspace (US3) and must not get a
 * workspace of its own. Skipping creation is harmless if the header is misused: the person can
 * still create a workspace later (FR-023).
 */
export function isInvitationSignUp(headers: Headers | undefined): boolean {
  return Boolean(headers?.get(INVITATION_HEADER));
}
