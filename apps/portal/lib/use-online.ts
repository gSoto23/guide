"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

/**
 * Connection state for property onboarding (T031, spec edge case "offline"). While offline,
 * creation, imports, uploads, and calendar changes are disabled with an explanation, and form
 * drafts stay in sessionStorage until the connection returns.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** True while the browser reports a connection. The server render assumes online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

const DRAFT_PREFIX = "guidesk.draft.";

function readDraft<T>(key: string): T | undefined {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Form state kept in sessionStorage under `key`, so a draft survives a lost connection or a
 * reload in the same tab. Never store codes, links, or credentials in a draft: `exclude` lists
 * fields that are never written. `clear` removes the draft after a successful submit.
 */
export function useSessionDraft<T extends Record<string, unknown>>(
  key: string,
  initial: T,
  exclude: readonly (keyof T)[] = [],
): [T, (next: T) => void, () => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    const saved = readDraft<Partial<T>>(key);
    if (saved) setValue((current) => ({ ...current, ...saved }));
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        const kept = Object.fromEntries(
          Object.entries(next).filter(([field]) => !exclude.includes(field as keyof T)),
        );
        window.sessionStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(kept));
      } catch {
        // Storage can be full or blocked; the form still works without a draft.
      }
    },
    [exclude, key],
  );

  const clear = useCallback(() => {
    try {
      window.sessionStorage.removeItem(DRAFT_PREFIX + key);
    } catch {
      // Nothing to clear.
    }
  }, [key]);

  return [value, update, clear];
}
