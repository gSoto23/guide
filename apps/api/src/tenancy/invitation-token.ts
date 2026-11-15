import { createHash, randomBytes } from "node:crypto";

/** A 256-bit invitation token for the email link; only its hash is stored (data model §3). */
export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Tokens are 43 base64url characters; anything else is rejected before touching the database. */
export function isWellFormedToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Cookie that marks a sign-up started from an invitation link (FR-020). */
export const INVITATION_COOKIE = "guidesk.invite";
