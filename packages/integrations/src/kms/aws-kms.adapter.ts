import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import {
  DATA_KEY_BYTES,
  KeyManagementError,
  encryptionContext,
  type DataKeyContext,
  type GeneratedDataKey,
  type KeyManagementPort,
} from "./port.js";

export interface AwsKeyManagementOptions {
  /** The customer-managed key for restricted data (`KMS_KEY_ID`): an ARN or an alias. */
  keyId: string;
  /** Defaults to a client with the ECS task role's credentials and the task's region. */
  client?: Pick<KMSClient, "send">;
}

/**
 * AWS KMS adapter (research R5, ADR-0009). Data keys come from `GenerateDataKey` and are
 * unwrapped with `Decrypt`, both with the encryption context `{workspace_id}` that the key policy
 * requires.
 */
export class AwsKeyManagement implements KeyManagementPort {
  readonly #client: Pick<KMSClient, "send">;
  readonly #keyId: string;

  constructor(options: AwsKeyManagementOptions) {
    if (!options.keyId) {
      throw new KeyManagementError("AwsKeyManagement requires a KMS key ID");
    }
    this.#keyId = options.keyId;
    this.#client = options.client ?? new KMSClient({});
  }

  async generateDataKey(context: DataKeyContext): Promise<GeneratedDataKey> {
    const command = new GenerateDataKeyCommand({
      KeyId: this.#keyId,
      KeySpec: "AES_256",
      EncryptionContext: encryptionContext(context),
    });
    const output = await this.#client.send(command).catch((error: unknown) => {
      throw failure("GenerateDataKey", error);
    });

    const { Plaintext, CiphertextBlob, KeyId } = output;
    if (Plaintext?.byteLength !== DATA_KEY_BYTES || !CiphertextBlob?.byteLength) {
      Plaintext?.fill(0);
      throw new KeyManagementError("KMS GenerateDataKey returned an incomplete data key");
    }
    return {
      plaintext: asBuffer(Plaintext),
      wrapped: Buffer.from(CiphertextBlob),
      kmsKeyId: KeyId ?? this.#keyId,
    };
  }

  async decryptDataKey(wrapped: Buffer, context: DataKeyContext): Promise<Buffer> {
    const command = new DecryptCommand({
      CiphertextBlob: wrapped,
      KeyId: this.#keyId,
      EncryptionContext: encryptionContext(context),
    });
    const output = await this.#client.send(command).catch((error: unknown) => {
      throw failure("Decrypt", error);
    });

    const { Plaintext } = output;
    if (Plaintext?.byteLength !== DATA_KEY_BYTES) {
      Plaintext?.fill(0);
      throw new KeyManagementError("KMS Decrypt did not return a 32-byte data key");
    }
    return asBuffer(Plaintext);
  }
}

/** A Buffer view over the SDK's bytes, so no second copy of the key is left behind. */
function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Replaces an SDK error with one that carries only the operation, the error type, and the request
 * ID. The SDK error is not kept as `cause`, so its request and response never reach a log.
 */
function failure(operation: string, error: unknown): KeyManagementError {
  const code = error instanceof Error ? error.name : "UnknownError";
  const requestId = (error as { $metadata?: { requestId?: string } } | null)?.$metadata?.requestId;
  const suffix = requestId ? `, request ${requestId}` : "";
  return new KeyManagementError(`KMS ${operation} failed (${code}${suffix})`, code);
}
