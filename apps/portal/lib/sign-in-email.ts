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

const RETURN_KEY = "guidesk.returnTo";
/** Only an invitation page of this portal: never an arbitrary URL, so no open redirect. */
const RETURN_PATH = /^\/(es|en)\/invite\/[A-Za-z0-9_-]{43}$/;

/** Where to go after signing in, when sign-in started from an invitation link (FR-020). */
export function rememberReturnTo(path: string): void {
  if (!RETURN_PATH.test(path)) return;
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // Without storage the user lands on onboarding and can reopen the link.
  }
}

export function readReturnTo(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    return path && RETURN_PATH.test(path) ? path : null;
  } catch {
    return null;
  }
}

export function forgetReturnTo(): void {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // Nothing to clean up.
  }
}
