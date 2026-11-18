/**
 * Autosave helpers for the section editor (feature 003 research R3, FR-011, FR-070): unsent text
 * is kept on the device per item and language, and sent when the connection returns. Storage may
 * be unavailable (private windows, blocked site data), so every access is guarded.
 */
const PREFIX = "guidesk:guide-draft:";

export function draftKey(itemId: string, language: string): string {
  return `${PREFIX}${itemId}:${language}`;
}

export function saveLocalDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, at: Date.now() }));
  } catch {
    // Storage unavailable: the text is still in the editor.
  }
}

export function readLocalDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return (JSON.parse(raw) as { value: T }).value;
  } catch {
    return null;
  }
}

export function clearLocalDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

/** Saves 1 second after the last change (research R3). */
export const AUTOSAVE_DELAY_MS = 1000;

/**
 * Runs section writes one at a time, each with the latest revision, so two autosaves never race
 * into a revision conflict of their own (FR-012).
 */
export function createWriteQueue() {
  let chain: Promise<unknown> = Promise.resolve();
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task, task);
    chain = next.catch(() => undefined);
    return next;
  };
}
