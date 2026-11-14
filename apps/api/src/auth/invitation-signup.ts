import { INVITATION_COOKIE, isWellFormedToken } from "../tenancy/invitation-token.js";

/**
 * The invitation token from the `guidesk.invite` cookie, which the public invitation lookup sets
 * (FR-020). It rides every sign-up path to /api/auth, including the Google callback. The sign-up
 * hook trusts it only after checking it against a pending invitation for the same email.
 */
export function invitationTokenFrom(headers: Headers | undefined): string | null {
  const raw = headers?.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === INVITATION_COOKIE) {
      const value = rest.join("=");
      return isWellFormedToken(value) ? value : null;
    }
  }
  return null;
}
