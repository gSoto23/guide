/**
 * Encryption of restricted values (research R5, SEC-06): AES-256-GCM under the workspace's active
 * data key, with a random 96-bit IV and the AAD `workspace_id|table|column|row_id`. The API and
 * the worker both encrypt; neither ever logs the plaintext.
 */
import { createCipheriv, randomBytes } from "node:crypto";
import type { KeyManagementPort } from "@guidesk/integrations";
import { DataKeyRing, type DataKeyOptions, type DataKeyStore } from "./data-keys.js";
import {
  CIPHER,
  IV_BYTES,
  TAG_BYTES,
  aadBytes,
  packEnvelope,
  type FieldAad,
} from "./internal/envelope.js";

export type VaultOptions = DataKeyOptions;

export interface EncryptedValue {
  /** `version || iv || ciphertext || tag`, for a `*_ciphertext` column. */
  ciphertext: Buffer;
  /** Store in the row's `data_key_id`; decryption needs it after the key is retired. */
  dataKeyId: string;
}

export class Vault {
  readonly #keys: DataKeyRing;

  constructor(kms: KeyManagementPort, options: VaultOptions = {}) {
    this.#keys = new DataKeyRing(kms, options);
  }

  /**
   * Encrypts a value for one row and column. Creates the workspace's first data key when it has
   * none. `aad.rowId` must be the ID the row is stored with.
   */
  async encrypt(
    store: DataKeyStore,
    aad: FieldAad,
    plaintext: string | Buffer,
  ): Promise<EncryptedValue> {
    const additionalData = aadBytes(aad);
    const { id, key } = await this.#keys.active(store, aad.workspaceId);
    const input = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
    try {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(CIPHER, key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(additionalData);
      const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
      return {
        ciphertext: packEnvelope({ iv, ciphertext, tag: cipher.getAuthTag() }),
        dataKeyId: id,
      };
    } finally {
      key.fill(0);
      // Only the copy made here; a caller's Buffer stays theirs.
      if (input !== plaintext) input.fill(0);
    }
  }
}
