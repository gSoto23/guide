/**
 * Decryption of restricted values (research R5, SEC-06). Only worker modules may import this
 * entry point (`@guidesk/vault/decrypt`, enforced by ESLint): the API encrypts but never reads
 * plaintext back. The caller must never log, serialize, or return what it decrypts.
 */
import { createDecipheriv } from "node:crypto";
import type { KeyManagementPort } from "@guidesk/integrations";
import { DataKeyRing, type DataKeyOptions, type DataKeyStore } from "./data-keys.js";
import { VaultError } from "./errors.js";
import { CIPHER, TAG_BYTES, aadBytes, unpackEnvelope, type FieldAad } from "./internal/envelope.js";

export { VaultError } from "./errors.js";
export type { FieldAad } from "./internal/envelope.js";

export type VaultDecrypterOptions = DataKeyOptions;

/** Where the value is stored, and the key its row names. */
export interface StoredValueAad extends FieldAad {
  /** The row's `data_key_id`, which may point to a retired key. */
  dataKeyId: string;
}

export class VaultDecrypter {
  readonly #keys: DataKeyRing;

  constructor(kms: KeyManagementPort, options: VaultDecrypterOptions = {}) {
    this.#keys = new DataKeyRing(kms, options);
  }

  /** Decrypts a value; fails when it was encrypted for another row, column, or workspace. */
  async decrypt(store: DataKeyStore, aad: StoredValueAad, ciphertext: Buffer): Promise<Buffer> {
    const additionalData = aadBytes(aad);
    const envelope = unpackEnvelope(ciphertext);
    const key = await this.#keys.byId(store, aad.workspaceId, aad.dataKeyId);
    let head: Buffer | undefined;
    try {
      const decipher = createDecipheriv(CIPHER, key, envelope.iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(additionalData);
      decipher.setAuthTag(envelope.tag);
      head = decipher.update(envelope.ciphertext);
      return Buffer.concat([head, decipher.final()]);
    } catch {
      // GCM authentication failed: wrong location, wrong key, or tampered bytes.
      throw new VaultError("The restricted value could not be decrypted");
    } finally {
      key.fill(0);
      head?.fill(0);
    }
  }

  /** Decrypts a UTF-8 value. */
  async decryptText(store: DataKeyStore, aad: StoredValueAad, ciphertext: Buffer): Promise<string> {
    const bytes = await this.decrypt(store, aad, ciphertext);
    try {
      return bytes.toString("utf8");
    } finally {
      bytes.fill(0);
    }
  }
}
