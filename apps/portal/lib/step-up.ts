"use client";

import { apiFetch } from "./api";
import { loadAuthClient } from "./auth-client";

export type StepUpMethod = "passkey" | "totp" | "email_otp";

/**
 * Runs one step-up method (FR-011, T063):
 * - passkey: a fresh passkey sign-in (new session, MFA-strength);
 * - totp: verifies the authenticator code for the current session;
 * - email_otp: verifies an emailed code for the current session.
 */
export async function passkeyStepUp(expectedUserId?: string): Promise<boolean> {
  const auth = await loadAuthClient();
  const result = await auth.signIn.passkey();
  if (result?.error) return false;
  // A passkey sign-in starts a new session for whoever owns the passkey. If that's someone else,
  // drop it rather than continue as them (T103).
  if (expectedUserId) {
    const after = await auth.getSession();
    if (after.data?.user.id !== expectedUserId) {
      await auth.signOut();
      return false;
    }
  }
  return true;
}

/** The signed-in user's ID, for passkeyStepUp. */
export async function currentUserId(): Promise<string | undefined> {
  const session = await (await loadAuthClient()).getSession();
  return session.data?.user.id;
}

export async function totpStepUp(code: string): Promise<boolean> {
  const result = await (await loadAuthClient()).twoFactor.verifyTotp({ code });
  return !result.error;
}

export async function requestEmailStepUp(): Promise<void> {
  await apiFetch("/api/v1/me/step-up/challenge", { method: "POST", body: { method: "email_otp" } });
}

export async function emailStepUp(code: string): Promise<boolean> {
  try {
    await apiFetch("/api/v1/me/step-up/verify", {
      method: "POST",
      body: { method: "email_otp", code },
    });
    return true;
  } catch {
    return false;
  }
}
