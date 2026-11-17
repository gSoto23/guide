/**
 * In-memory cache of unwrapped data keys (research R5): at most 5 minutes per key, which keeps
 * KMS calls low. Not exported from the package.
 *
 * Keys are held in private fields, so `util.inspect` and `JSON.stringify` never show them. The
 * cache hands out copies and keeps its own, so dropping an entry can zero-fill its buffer without
 * touching a key that an encryption in progress is still using.
 */
import { VaultError } from "../errors.js";

/** Research R5: unwrapped data keys stay in memory for at most 5 minutes. */
export const MAX_CACHE_TTL_MS = 5 * 60 * 1000;

interface Entry {
  workspaceId: string;
  key: Buffer;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class DataKeyCache {
  readonly #entries = new Map<string, Entry>();
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(ttlMs: number = MAX_CACHE_TTL_MS, now: () => number = () => performance.now()) {
    if (!Number.isFinite(ttlMs) || ttlMs < 0 || ttlMs > MAX_CACHE_TTL_MS) {
      throw new VaultError("Data key cache TTL must be between 0 and 5 minutes");
    }
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  /** A copy of the cached key, which the caller zero-fills after use; undefined when absent. */
  get(dataKeyId: string, workspaceId: string): Buffer | undefined {
    this.#sweep();
    const entry = this.#entries.get(dataKeyId);
    if (!entry || entry.workspaceId !== workspaceId) return undefined;
    return Buffer.from(entry.key);
  }

  /** Stores a private copy of `key`; the caller keeps ownership of its own buffer. */
  set(dataKeyId: string, workspaceId: string, key: Buffer): void {
    this.#drop(dataKeyId);
    this.#sweep();
    const entry: Entry = {
      workspaceId,
      key: Buffer.from(key),
      expiresAt: this.#now() + this.#ttlMs,
    };
    // A real timer drops the key even if nothing reads the cache again; the clock check in
    // #sweep covers reads and an injected clock.
    entry.timer = setTimeout(() => {
      if (this.#entries.get(dataKeyId) === entry) this.#drop(dataKeyId);
    }, this.#ttlMs);
    entry.timer.unref?.();
    this.#entries.set(dataKeyId, entry);
  }

  /** Number of keys still within their TTL. */
  get size(): number {
    this.#sweep();
    return this.#entries.size;
  }

  /** Drops and zero-fills every key. */
  clear(): void {
    for (const dataKeyId of [...this.#entries.keys()]) this.#drop(dataKeyId);
  }

  #sweep(): void {
    const now = this.#now();
    for (const [dataKeyId, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#drop(dataKeyId);
    }
  }

  #drop(dataKeyId: string): void {
    const entry = this.#entries.get(dataKeyId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.key.fill(0);
    this.#entries.delete(dataKeyId);
  }
}
