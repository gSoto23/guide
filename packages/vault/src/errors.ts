/**
 * A vault failure (research R5). Messages are fixed strings: they never contain plaintext, key
 * material, or ciphertext, and crypto errors are not kept as `cause`.
 */
export class VaultError extends Error {
  override readonly name = "VaultError";
}
