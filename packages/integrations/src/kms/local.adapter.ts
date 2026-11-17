import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  DATA_KEY_BYTES,
  KeyManagementError,
  encryptionContext,
  type DataKeyContext,
  type GeneratedDataKey,
  type KeyManagementPort,
} from "./port.js";

const FORMAT_VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** `version || iv || wrapped key || tag`. */
const WRAPPED_BYTES = 1 + IV_BYTES + DATA_KEY_BYTES + TAG_BYTES;

/** Stored as `workspace_data_key.kms_key_id` for keys wrapped by this adapter. */
export const LOCAL_KMS_KEY_ID = "local";

/**
 * Stand-in for AWS KMS in development and CI only (research R5); production settings refuse
 * `KMS_MODE=local`. Data keys are wrapped with AES-256-GCM under `LOCAL_KMS_KEY`, and the
 * additional authenticated data `workspace_id:<id>` plays the role of the KMS encryption context:
 * a wrapped key unwraps only for the workspace it was created for.
 */
export class LocalKeyManagement implements KeyManagementPort {
  readonly #localKey: Buffer;

  constructor(localKey: Buffer) {
    if (localKey.length !== DATA_KEY_BYTES) {
      throw new KeyManagementError("LOCAL_KMS_KEY must be 32 bytes");
    }
    this.#localKey = Buffer.from(localKey);
  }

  async generateDataKey(context: DataKeyContext): Promise<GeneratedDataKey> {
    const aad = additionalData(context);
    const plaintext = randomBytes(DATA_KEY_BYTES);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#localKey, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(aad);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrapped = Buffer.concat([Buffer.of(FORMAT_VERSION), iv, body, cipher.getAuthTag()]);
    return { plaintext, wrapped, kmsKeyId: LOCAL_KMS_KEY_ID };
  }

  async decryptDataKey(wrapped: Buffer, context: DataKeyContext): Promise<Buffer> {
    const aad = additionalData(context);
    if (wrapped.length !== WRAPPED_BYTES || wrapped[0] !== FORMAT_VERSION) {
      throw new KeyManagementError("Local KMS could not unwrap the data key", "InvalidCiphertext");
    }
    const iv = wrapped.subarray(1, 1 + IV_BYTES);
    const body = wrapped.subarray(1 + IV_BYTES, 1 + IV_BYTES + DATA_KEY_BYTES);
    const tag = wrapped.subarray(1 + IV_BYTES + DATA_KEY_BYTES);
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#localKey, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      // Wrong workspace, wrong local key, or tampered bytes: GCM authentication failed.
      throw new KeyManagementError("Local KMS could not unwrap the data key", "InvalidCiphertext");
    }
  }
}

function additionalData(context: DataKeyContext): Buffer {
  return Buffer.from(`workspace_id:${encryptionContext(context).workspace_id}`, "utf8");
}
