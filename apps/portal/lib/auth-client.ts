"use client";

import { useEffect } from "react";
import type { AuthClient } from "./auth-client-impl";

export type { AuthClient };

let pending: Promise<AuthClient> | undefined;

/**
 * Loads the Better Auth client on first use (T101). It stays out of every page's initial
 * JavaScript, so auth screens fit the 150 KB budget. Screens that need it call this on mount, so
 * the module is ready before the first tap: a passkey prompt must start while the tap still
 * counts as a user gesture.
 */
export function loadAuthClient(): Promise<AuthClient> {
  pending ??= import("./auth-client-impl").then((module) => module.authClient);
  return pending;
}

/** Starts loading the client after the screen renders, so it is ready by the first tap. */
export function usePreloadAuthClient(): void {
  useEffect(() => {
    void loadAuthClient();
  }, []);
}
