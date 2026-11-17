/**
 * Per-workspace data keys (research R5, data model §1 `workspace_data_key`). Each workspace has
 * one `active` key, created on first use with `GenerateDataKey`; only the wrapped copy is stored.
 * Yearly rotation retires it, and retired keys still decrypt the values that name them.
 */
import { and, eq } from "drizzle-orm";
import {
  workspaceDataKey,
  type DATA_KEY_STATUSES,
  type Database,
  type Transaction,
} from "@guidesk/db";
import type { KeyManagementPort } from "@guidesk/integrations";
import { VaultError } from "./errors.js";
import { KEY_BYTES } from "./internal/envelope.js";
import { DataKeyCache, MAX_CACHE_TTL_MS } from "./internal/key-cache.js";

export interface StoredDataKey {
  id: string;
  workspaceId: string;
  /** The data key wrapped by KMS with the encryption context `{workspace_id}`. */
  wrappedKey: Buffer;
  /** The KMS key ARN, or `local` in development and CI. */
  kmsKeyId: string;
  status: (typeof DATA_KEY_STATUSES)[number];
}

/** Access to `workspace_data_key`, kept behind an interface so the vault is testable without a database. */
export interface DataKeyStore {
  findActive(workspaceId: string): Promise<StoredDataKey | null>;
  findById(workspaceId: string, id: string): Promise<StoredDataKey | null>;
  /**
   * Stores a new active key. When another transaction stored the workspace's active key first,
   * returns that key instead.
   */
  insertActive(workspaceId: string, wrappedKey: Buffer, kmsKeyId: string): Promise<StoredDataKey>;
}

const columns = {
  id: workspaceDataKey.id,
  workspaceId: workspaceDataKey.workspaceId,
  wrappedKey: workspaceDataKey.wrappedKey,
  kmsKeyId: workspaceDataKey.kmsKeyId,
  status: workspaceDataKey.status,
};

/**
 * The Drizzle store. In the API, pass the request transaction (`withRlsContext`): RLS lets owners
 * and admins read keys and insert `active` ones. The worker passes its system-context handle.
 */
export function createDataKeyStore(db: Database | Transaction): DataKeyStore {
  const findActive = async (workspaceId: string): Promise<StoredDataKey | null> => {
    const [row] = await db
      .select(columns)
      .from(workspaceDataKey)
      .where(
        and(eq(workspaceDataKey.workspaceId, workspaceId), eq(workspaceDataKey.status, "active")),
      )
      .limit(1);
    return row ?? null;
  };

  return {
    findActive,

    async findById(workspaceId, id) {
      const [row] = await db
        .select(columns)
        .from(workspaceDataKey)
        .where(and(eq(workspaceDataKey.id, id), eq(workspaceDataKey.workspaceId, workspaceId)))
        .limit(1);
      return row ?? null;
    },

    async insertActive(workspaceId, wrappedKey, kmsKeyId) {
      // Two requests can create a workspace's first key at once. The partial unique index keeps
      // one; `ON CONFLICT DO NOTHING` turns the loser's unique violation into an empty result
      // without aborting its transaction, and the loser then reads the winner's key (visible
      // under READ COMMITTED once the winner commits).
      const [row] = await db
        .insert(workspaceDataKey)
        .values({ workspaceId, wrappedKey, kmsKeyId, status: "active" })
        .onConflictDoNothing()
        .returning(columns);
      if (row) return row;
      const winner = await findActive(workspaceId);
      if (!winner) {
        throw new VaultError("The workspace's active data key could not be created or read");
      }
      return winner;
    },
  };
}

export interface DataKeyOptions {
  /** How long an unwrapped key stays cached; at most (and by default) 5 minutes. */
  cacheTtlMs?: number;
  /** Monotonic clock in milliseconds, for tests. */
  now?: () => number;
}

/**
 * Resolves unwrapped data keys through KMS and the cache. Every returned key is a fresh copy that
 * the caller zero-fills after use. Internal: not exported from the package.
 */
export class DataKeyRing {
  readonly #kms: KeyManagementPort;
  readonly #cache: DataKeyCache;

  constructor(kms: KeyManagementPort, options: DataKeyOptions = {}) {
    this.#kms = kms;
    this.#cache = new DataKeyCache(options.cacheTtlMs ?? MAX_CACHE_TTL_MS, options.now);
  }

  /** The workspace's active data key, created on first use. */
  async active(store: DataKeyStore, workspaceId: string): Promise<{ id: string; key: Buffer }> {
    const existing = await store.findActive(workspaceId);
    if (existing) return { id: existing.id, key: await this.#unwrap(existing, workspaceId) };

    const generated = await this.#kms.generateDataKey({ workspaceId });
    try {
      if (generated.plaintext.length !== KEY_BYTES) {
        throw new VaultError("KMS returned a data key of the wrong length");
      }
      const stored = await store.insertActive(workspaceId, generated.wrapped, generated.kmsKeyId);
      if (stored.workspaceId === workspaceId && stored.wrappedKey.equals(generated.wrapped)) {
        this.#cache.set(stored.id, workspaceId, generated.plaintext);
        return { id: stored.id, key: Buffer.from(generated.plaintext) };
      }
      // Another request created the workspace's first key at the same time: use that one.
      return { id: stored.id, key: await this.#unwrap(stored, workspaceId) };
    } finally {
      generated.plaintext.fill(0);
    }
  }

  /** The key a stored value names (`data_key_id`), active or retired. */
  async byId(store: DataKeyStore, workspaceId: string, dataKeyId: string): Promise<Buffer> {
    const stored = await store.findById(workspaceId, dataKeyId);
    if (!stored) throw new VaultError("The data key for this value was not found");
    return this.#unwrap(stored, workspaceId);
  }

  async #unwrap(stored: StoredDataKey, workspaceId: string): Promise<Buffer> {
    if (stored.workspaceId !== workspaceId) {
      throw new VaultError("The data key belongs to another workspace");
    }
    const cached = this.#cache.get(stored.id, workspaceId);
    if (cached) return cached;

    const key = await this.#kms.decryptDataKey(stored.wrappedKey, { workspaceId });
    try {
      if (key.length !== KEY_BYTES) {
        throw new VaultError("KMS returned a data key of the wrong length");
      }
      this.#cache.set(stored.id, workspaceId, key);
      return Buffer.from(key);
    } finally {
      key.fill(0);
    }
  }
}
