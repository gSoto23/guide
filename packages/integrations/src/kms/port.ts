/**
 * Key management for envelope encryption (research R5, SEC-06, ADR-0009). A KMS master key wraps
 * one data key per workspace; restricted values are encrypted with the data key by
 * `@guidesk/vault`, never by KMS directly.
 *
 * Every call carries the encryption context `{workspace_id}`, so a wrapped data key copied to
 * another workspace cannot be unwrapped. The KMS key policy requires that context key.
 *
 * Unwrapped data keys (`plaintext`) are secrets: never log them, serialize them, or put them in
 * an error, and zero-fill them when they are no longer needed.
 */

/** Data keys are AES-256 keys. */
export const DATA_KEY_BYTES = 32;

/** The encryption context a data key is bound to. */
export interface DataKeyContext {
  workspaceId: string;
}

export interface GeneratedDataKey {
  /** The unwrapped AES-256 key. Never stored, logged, or serialized. */
  plaintext: Buffer;
  /** The key wrapped by the master key; the only copy that is stored (`workspace_data_key`). */
  wrapped: Buffer;
  /** The master key that wrapped it: the KMS key ARN, or `local` in development and CI. */
  kmsKeyId: string;
}

export interface KeyManagementPort {
  /** Creates a new AES-256 data key bound to the workspace. */
  generateDataKey(context: DataKeyContext): Promise<GeneratedDataKey>;
  /** Unwraps a data key. Fails when the context differs from the one it was created with. */
  decryptDataKey(wrapped: Buffer, context: DataKeyContext): Promise<Buffer>;
}

/**
 * A key management failure. The message names the operation and, for AWS, the error type and
 * request ID; it never contains key material, wrapped or not.
 */
export class KeyManagementError extends Error {
  override readonly name = "KeyManagementError";

  constructor(
    message: string,
    /** Provider error type, for example `InvalidCiphertextException`. */
    readonly code?: string,
  ) {
    super(message);
  }
}

/** The KMS encryption context for a workspace (research R5). */
export function encryptionContext(context: DataKeyContext): { workspace_id: string } {
  if (!context.workspaceId) {
    throw new KeyManagementError("A data key needs a workspace ID");
  }
  return { workspace_id: context.workspaceId };
}
