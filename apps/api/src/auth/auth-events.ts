import type { Assurance, AuthMethod } from "./assurance.service.js";

export type FactorChange = "passkey_added" | "passkey_removed" | "totp_enabled" | "totp_disabled";

export type SecondFactorMethod = "totp" | "recovery_code";

/** Why a factor-management request was refused (security review T103). */
export type FactorGate = "ok" | "step_up_required" | "second_factor_required";

/** What auth hooks report to Guidesk services (wired in AuthModule). */
export interface AuthEventHandlers {
  onUserCreated(
    user: { id: string; name: string | null; preferredLanguage: string | null },
    headers: Headers | undefined,
  ): Promise<void>;
  /** Assurance of a session that is about to be replaced by a rotation (copied to the new one). */
  assuranceOf(sessionId: string): Promise<Assurance>;
  onSessionCreated(
    session: { id: string; userId: string },
    method: AuthMethod | null,
    headers: Headers | undefined,
    /** Set when the library rotated an existing session instead of signing in. */
    rotatedFrom: Assurance | null,
  ): Promise<void>;
  isEmailLocked(email: string): Promise<boolean>;
  isUserLocked(userId: string): Promise<boolean>;
  /** Per-email send limit for sign-in codes (research R8, AC-SEC-008). False when exceeded. */
  allowCodeSend(email: string): Promise<boolean>;
  /** True when an unexpired sign-in code exists for the email (only then can a guess fail). */
  hasPendingSignInCode(email: string): Promise<boolean>;
  /** True when the session re-authenticated within the last 10 minutes (FR-011). */
  isStepUpFresh(sessionId: string): Promise<boolean>;
  /** Adding or removing a sign-in factor: step-up, and a second factor when the user has one. */
  factorGate(session: { id: string; userId: string }): Promise<FactorGate>;
  isTotpCodeUsed(userId: string, code: string): Promise<boolean>;
  afterEmailOtpSignIn(email: string, succeeded: boolean, counted: boolean): Promise<void>;
  afterTotpVerified(
    session: { id: string; userId: string },
    enabling: boolean,
    code: string,
    headers: Headers | undefined,
  ): Promise<void>;
  afterSecondFactorFailed(userId: string, method: SecondFactorMethod): Promise<void>;
  afterBackupCodeUsed(session: { id: string; userId: string }): Promise<void>;
  afterFactorChanged(
    userId: string,
    change: FactorChange,
    headers: Headers | undefined,
    /** For removals: the session to keep; every other session of the user is revoked (FR-013). */
    keepSessionId?: string,
  ): Promise<void>;
  afterSessionsRevoked(userId: string, all: boolean): Promise<void>;
}

/** Sessions end 30 days after sign-in, even with daily use (FR-015). */
export const ABSOLUTE_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/** Maps the Better Auth endpoint that created a session to the sign-in method. */
export function methodFromPath(path: string | undefined): AuthMethod | null {
  if (!path) return null;
  if (path === "/sign-in/email-otp") return "email_otp";
  if (path === "/passkey/verify-authentication") return "passkey";
  if (path.startsWith("/callback/")) return "google";
  return null;
}

/**
 * Better Auth endpoints that add or remove a sign-in factor or recovery codes. They need a
 * recent re-authentication (FR-011) and, when the user already has a second factor, that
 * re-authentication must use it, so an email code alone can't swap the user's factors (T103).
 */
export const FACTOR_PATHS = new Set([
  "/two-factor/enable",
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/passkey/delete-passkey",
]);

/** Second-factor checks that count toward the user lockout (AC-SEC-001). */
export const SECOND_FACTOR_PATHS = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

/**
 * Library endpoints Guidesk does not use (T103). Disabled so they can't leak second-factor
 * secrets, reveal which emails have accounts, bypass the lockout, or set a password (FR-001).
 */
export const DISABLED_AUTH_PATHS = [
  "/two-factor/get-totp-uri",
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/email-otp/check-verification-otp",
  "/email-otp/verify-email",
  "/email-otp/request-password-reset",
  "/forget-password/email-otp",
  "/email-otp/reset-password",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
  "/update-user",
  "/link-social",
  "/unlink-account",
];

/** Sign-in endpoints: they start sessions, so the absolute-lifetime check does not apply. */
export const SIGN_IN_PATHS = new Set([
  "/email-otp/send-verification-otp",
  "/sign-in/email-otp",
  "/sign-in/social",
  "/passkey/generate-authenticate-options",
  "/passkey/verify-authentication",
]);
