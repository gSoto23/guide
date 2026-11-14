"use client";

import { apiFetch } from "./api";
import { authClient } from "./auth-client";

export type StepUpMethod = "passkey" | "totp" | "email_otp";

/**
 * Runs one step-up method (FR-011, T063):
 * - passkey: a fresh passkey sign-in (new session, MFA-strength);
 * - totp: verifies the authenticator code for the current session;
 * - email_otp: verifies an emailed code for the current session.
 */
export async function passkeyStepUp(): Promise<boolean> {
  const result = await authClient.signIn.passkey();
  return !result?.error;
}

export async function totpStepUp(code: string): Promise<boolean> {
  const result = await authClient.twoFactor.verifyTotp({ code });
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
