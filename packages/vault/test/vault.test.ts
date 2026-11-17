import { createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  LocalKeyManagement,
  type DataKeyContext,
  type GeneratedDataKey,
  type KeyManagementPort,
} from "@guidesk/integrations";
import { Vault, VaultError, type DataKeyStore, type StoredDataKey } from "../src/index.js";
import { VaultDecrypter, type StoredValueAad } from "../src/decrypt.js";
import { DataKeyCache, MAX_CACHE_TTL_MS } from "../src/internal/key-cache.js";

/** `workspace_data_key` in memory, with the partial unique index on active keys. */
class MemoryDataKeyStore implements DataKeyStore {
  readonly rows: StoredDataKey[] = [];

  async findActive(workspaceId: string): Promise<StoredDataKey | null> {
    return this.active(workspaceId);
  }

  async findById(workspaceId: string, id: string): Promise<StoredDataKey | null> {
    return this.rows.find((r) => r.workspaceId === workspaceId && r.id === id) ?? null;
  }

  async insertActive(
    workspaceId: string,
    wrappedKey: Buffer,
    kmsKeyId: string,
  ): Promise<StoredDataKey> {
    // Checked and inserted without yielding, like the unique index: ON CONFLICT DO NOTHING, then
    // read the active key.
    const winner = this.active(workspaceId);
    if (winner) return winner;
    const row: StoredDataKey = {
      id: randomUUID(),
      workspaceId,
      wrappedKey: Buffer.from(wrappedKey),
      kmsKeyId,
      status: "active",
    };
    this.rows.push(row);
    return row;
  }

  private active(workspaceId: string): StoredDataKey | null {
    return this.rows.find((r) => r.workspaceId === workspaceId && r.status === "active") ?? null;
  }

  /** Yearly rotation: the active key is retired; the next encryption creates a new one. */
  retireActive(workspaceId: string): void {
    for (const row of this.rows) {
      if (row.workspaceId === workspaceId && row.status === "active") row.status = "retired";
    }
  }
}

/** Counts KMS calls and remembers every unwrapped key it hands out. */
class CountingKms implements KeyManagementPort {
  generated = 0;
  decrypted = 0;
  readonly plaintexts: Buffer[] = [];

  constructor(private readonly inner: KeyManagementPort) {}

  async generateDataKey(context: DataKeyContext): Promise<GeneratedDataKey> {
    this.generated += 1;
    const result = await this.inner.generateDataKey(context);
    this.plaintexts.push(Buffer.from(result.plaintext));
    return result;
  }

  async decryptDataKey(wrapped: Buffer, context: DataKeyContext): Promise<Buffer> {
    this.decrypted += 1;
    return this.inner.decryptDataKey(wrapped, context);
  }
}

const localKey = randomBytes(32);
const WORKSPACE_A = randomUUID();
const WORKSPACE_B = randomUUID();

function setup(options: { now?: () => number } = {}) {
  const kms = new CountingKms(new LocalKeyManagement(localKey));
  const store = new MemoryDataKeyStore();
  const vault = new Vault(kms, options);
  const decrypter = new VaultDecrypter(kms, options);
  return { kms, store, vault, decrypter };
}

function location(workspaceId = WORKSPACE_A, rowId = randomUUID()) {
  return { workspaceId, table: "pms_connection", column: "credential_ciphertext", rowId };
}

describe("Vault round trip (research R5)", () => {
  it("encrypts and decrypts a value", async () => {
    const { store, vault, decrypter } = setup();
    const aad = location();

    const { ciphertext, dataKeyId } = await vault.encrypt(store, aad, "beds24-refresh-token");

    expect(ciphertext.includes(Buffer.from("beds24-refresh-token"))).toBe(false);
    expect(await decrypter.decryptText(store, { ...aad, dataKeyId }, ciphertext)).toBe(
      "beds24-refresh-token",
    );
    const bytes = await decrypter.decrypt(store, { ...aad, dataKeyId }, ciphertext);
    expect(bytes.toString("utf8")).toBe("beds24-refresh-token");
  });

  it("encrypts Buffers and empty values, and leaves the caller's Buffer intact", async () => {
    const { store, vault, decrypter } = setup();
    const aad = location();
    const input = Buffer.from([0, 1, 2, 250, 255]);

    const binary = await vault.encrypt(store, aad, input);
    const empty = await vault.encrypt(store, aad, "");

    expect([...input]).toEqual([0, 1, 2, 250, 255]);
    const decrypted = await decrypter.decrypt(
      store,
      { ...aad, dataKeyId: binary.dataKeyId },
      binary.ciphertext,
    );
    expect(decrypted.equals(input)).toBe(true);
    expect(
      await decrypter.decryptText(store, { ...aad, dataKeyId: empty.dataKeyId }, empty.ciphertext),
    ).toBe("");
  });

  it("creates one active key per workspace on first use and stores only the wrapped copy", async () => {
    const { kms, store, vault } = setup();

    const first = await vault.encrypt(store, location(WORKSPACE_A), "a1");
    const second = await vault.encrypt(store, location(WORKSPACE_A), "a2");
    const other = await vault.encrypt(store, location(WORKSPACE_B), "b1");

    expect(kms.generated).toBe(2);
    expect(first.dataKeyId).toBe(second.dataKeyId);
    expect(other.dataKeyId).not.toBe(first.dataKeyId);
    expect(store.rows.map((r) => [r.workspaceId, r.status, r.kmsKeyId])).toEqual([
      [WORKSPACE_A, "active", "local"],
      [WORKSPACE_B, "active", "local"],
    ]);
    for (const [index, row] of store.rows.entries()) {
      const plaintext = kms.plaintexts[index] as Buffer;
      expect(row.wrappedKey.equals(plaintext)).toBe(false);
      expect(row.wrappedKey.includes(plaintext)).toBe(false);
    }
  });

  it("keeps a single key when two requests create the first one at the same time", async () => {
    const { kms, store, vault, decrypter } = setup();
    const otherTask = new Vault(kms); // a second API task, with its own cache
    const aadOne = location();
    const aadTwo = location();

    const [one, two] = await Promise.all([
      vault.encrypt(store, aadOne, "one"),
      otherTask.encrypt(store, aadTwo, "two"),
    ]);

    expect(kms.generated).toBe(2);
    expect(store.rows).toHaveLength(1);
    expect(one.dataKeyId).toBe(two.dataKeyId);
    // The loser drops the key it generated and unwraps the winner's.
    expect(kms.decrypted).toBe(1);
    expect(
      await decrypter.decryptText(store, { ...aadOne, dataKeyId: one.dataKeyId }, one.ciphertext),
    ).toBe("one");
    expect(
      await decrypter.decryptText(store, { ...aadTwo, dataKeyId: two.dataKeyId }, two.ciphertext),
    ).toBe("two");
  });
});

describe("Vault binding to the location (AAD)", () => {
  async function encrypted() {
    const context = setup();
    const aad = location();
    const value = await context.vault.encrypt(
      context.store,
      aad,
      "https://example.com/ical/abc.ics",
    );
    return { ...context, aad, value, stored: { ...aad, dataKeyId: value.dataKeyId } };
  }

  it("fails to decrypt a ciphertext copied to another row", async () => {
    const { store, decrypter, value, stored } = await encrypted();
    const copied: StoredValueAad = { ...stored, rowId: randomUUID() };
    await expect(decrypter.decrypt(store, copied, value.ciphertext)).rejects.toThrow(
      new VaultError("The restricted value could not be decrypted"),
    );
  });

  it("fails to decrypt a ciphertext copied to another column or table", async () => {
    const { store, decrypter, value, stored } = await encrypted();
    await expect(
      decrypter.decrypt(store, { ...stored, column: "calendar_url_ciphertext" }, value.ciphertext),
    ).rejects.toBeInstanceOf(VaultError);
    await expect(
      decrypter.decrypt(store, { ...stored, table: "calendar_feed" }, value.ciphertext),
    ).rejects.toBeInstanceOf(VaultError);
  });

  it("fails to decrypt a ciphertext copied to another workspace", async () => {
    const { store, vault, decrypter, value, stored } = await encrypted();
    const workspaceBKey = await vault.encrypt(store, location(WORKSPACE_B), "b");

    // Naming the original key from workspace B: the key is not found there.
    await expect(
      decrypter.decrypt(store, { ...stored, workspaceId: WORKSPACE_B }, value.ciphertext),
    ).rejects.toThrow("data key for this value was not found");
    // Naming workspace B's own key: wrong key and wrong AAD.
    await expect(
      decrypter.decrypt(
        store,
        { ...stored, workspaceId: WORKSPACE_B, dataKeyId: workspaceBKey.dataKeyId },
        value.ciphertext,
      ),
    ).rejects.toThrow("could not be decrypted");
  });

  it("fails on tampered bytes, an unknown version, or a truncated value", async () => {
    const { store, decrypter, value, stored } = await encrypted();
    const tampered = Buffer.from(value.ciphertext);
    tampered[20] = (tampered[20] ?? 0) ^ 0x01;
    const wrongVersion = Buffer.from(value.ciphertext);
    wrongVersion[0] = 0x02;

    await expect(decrypter.decrypt(store, stored, tampered)).rejects.toThrow(
      "could not be decrypted",
    );
    await expect(decrypter.decrypt(store, stored, wrongVersion)).rejects.toThrow("unknown format");
    await expect(
      decrypter.decrypt(store, stored, value.ciphertext.subarray(0, 20)),
    ).rejects.toThrow("unknown format");
  });

  it("refuses locations with an empty part or a '|' separator", async () => {
    const { kms, store, vault } = setup();
    await expect(vault.encrypt(store, { ...location(), rowId: "" }, "x")).rejects.toBeInstanceOf(
      VaultError,
    );
    await expect(
      vault.encrypt(store, { ...location(), table: "pms_connection|x" }, "x"),
    ).rejects.toBeInstanceOf(VaultError);
    expect(kms.generated).toBe(0);
  });
});

describe("Vault stored format", () => {
  it("is version || iv (12) || ciphertext || tag (16), with AAD workspace_id|table|column|row_id", async () => {
    const { kms, store, vault } = setup();
    const aad = location();
    const plaintext = "1234#";

    const { ciphertext } = await vault.encrypt(store, aad, plaintext);

    expect(ciphertext[0]).toBe(0x01);
    expect(ciphertext).toHaveLength(1 + 12 + Buffer.byteLength(plaintext) + 16);

    // Decrypt by hand with the data key to pin the layout and the AAD string.
    const dataKey = kms.plaintexts[0] as Buffer;
    const decipher = createDecipheriv("aes-256-gcm", dataKey, ciphertext.subarray(1, 13));
    decipher.setAAD(
      Buffer.from(`${aad.workspaceId}|${aad.table}|${aad.column}|${aad.rowId}`, "utf8"),
    );
    decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
    const opened = Buffer.concat([
      decipher.update(ciphertext.subarray(13, ciphertext.length - 16)),
      decipher.final(),
    ]);
    expect(opened.toString("utf8")).toBe(plaintext);
  });

  it("uses a fresh random IV for every value", async () => {
    const { store, vault } = setup();
    const aad = location();
    const first = await vault.encrypt(store, aad, "same");
    const second = await vault.encrypt(store, aad, "same");
    expect(first.ciphertext.subarray(1, 13).equals(second.ciphertext.subarray(1, 13))).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });
});

describe("Vault key rotation", () => {
  it("still decrypts with a retired key, and encrypts new values with the new key", async () => {
    const { store, vault, decrypter } = setup();
    const oldAad = location();
    const newAad = location();

    const before = await vault.encrypt(store, oldAad, "before rotation");
    store.retireActive(WORKSPACE_A);
    const after = await vault.encrypt(store, newAad, "after rotation");

    expect(after.dataKeyId).not.toBe(before.dataKeyId);
    expect(store.rows.map((r) => r.status)).toEqual(["retired", "active"]);
    expect(
      await decrypter.decryptText(
        store,
        { ...oldAad, dataKeyId: before.dataKeyId },
        before.ciphertext,
      ),
    ).toBe("before rotation");
    expect(
      await decrypter.decryptText(
        store,
        { ...newAad, dataKeyId: after.dataKeyId },
        after.ciphertext,
      ),
    ).toBe("after rotation");
  });
});

describe("Vault data key cache", () => {
  it("drops an unwrapped data key from the cache after 5 minutes", async () => {
    let now = 0;
    const { kms, store, vault } = setup({ now: () => now });

    await vault.encrypt(store, location(), "1"); // generated: the plaintext is cached
    expect(kms.generated).toBe(1);
    expect(kms.decrypted).toBe(0);

    now = MAX_CACHE_TTL_MS - 1;
    await vault.encrypt(store, location(), "2");
    expect(kms.decrypted).toBe(0);

    now = MAX_CACHE_TTL_MS;
    await vault.encrypt(store, location(), "3"); // expired: unwrapped again through KMS
    expect(kms.decrypted).toBe(1);

    await vault.encrypt(store, location(), "4"); // cached again
    expect(kms.decrypted).toBe(1);
    expect(kms.generated).toBe(1);
  });

  it("caches keys for decryption for at most 5 minutes too", async () => {
    let now = 0;
    const { kms, store, vault, decrypter } = setup({ now: () => now });
    const aad = location();
    const value = await vault.encrypt(store, aad, "secret");
    const stored = { ...aad, dataKeyId: value.dataKeyId };

    await decrypter.decrypt(store, stored, value.ciphertext);
    await decrypter.decrypt(store, stored, value.ciphertext);
    expect(kms.decrypted).toBe(1);

    now = MAX_CACHE_TTL_MS + 1;
    await decrypter.decrypt(store, stored, value.ciphertext);
    expect(kms.decrypted).toBe(2);
  });

  it("removes expired entries and hands out copies that do not change the cache", () => {
    let now = 0;
    const cache = new DataKeyCache(MAX_CACHE_TTL_MS, () => now);
    const key = randomBytes(32);
    cache.set("k1", WORKSPACE_A, key);

    const copy = cache.get("k1", WORKSPACE_A) as Buffer;
    expect(copy.equals(key)).toBe(true);
    copy.fill(0);
    expect(cache.get("k1", WORKSPACE_A)?.equals(key)).toBe(true);
    expect(cache.get("k1", WORKSPACE_B)).toBeUndefined();

    now = MAX_CACHE_TTL_MS;
    expect(cache.size).toBe(0);
    expect(cache.get("k1", WORKSPACE_A)).toBeUndefined();
    cache.clear();
  });

  it("refuses a TTL longer than 5 minutes", () => {
    const kms = new LocalKeyManagement(localKey);
    expect(() => new Vault(kms, { cacheTtlMs: MAX_CACHE_TTL_MS + 1 })).toThrow(VaultError);
    expect(() => new VaultDecrypter(kms, { cacheTtlMs: -1 })).toThrow(VaultError);
  });

  it("never exposes cached keys through inspection or serialization", async () => {
    const { kms, store, vault, decrypter } = setup();
    const aad = location();
    const value = await vault.encrypt(store, aad, "secret");
    await decrypter.decrypt(store, { ...aad, dataKeyId: value.dataKeyId }, value.ciphertext);
    const dataKey = (kms.plaintexts[0] as Buffer).toString("hex");

    for (const holder of [vault, decrypter]) {
      expect(inspect(holder, { showHidden: true, depth: 10 }).replace(/\s|,/g, "")).not.toContain(
        dataKey.slice(0, 8),
      );
      expect(JSON.stringify(holder)).toBe("{}");
    }
  });
});
