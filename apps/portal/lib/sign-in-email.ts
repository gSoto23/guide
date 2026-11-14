"use client";

/**
 * The email being verified lives in this tab's sessionStorage, never in the URL, so it doesn't
 * end up in browser history or edge and server logs (SEC-20, security review T103).
 */
const KEY = "guidesk.signInEmail";

export function rememberSignInEmail(email: string): void {
  try {
    sessionStorage.setItem(KEY, email);
  } catch {
    // Storage can be unavailable (private mode); the verify page then asks to start again.
  }
}

export function readSignInEmail(): string {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function forgetSignInEmail(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up.
  }
}
