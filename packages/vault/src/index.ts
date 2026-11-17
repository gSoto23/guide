/**
 * Envelope encryption for restricted data (research R5, SEC-06). This entry point creates data
 * keys and encrypts. Decryption lives in `@guidesk/vault/decrypt`, which only the worker imports.
 */
export { Vault, type EncryptedValue, type VaultOptions } from "./encrypt.js";
export { createDataKeyStore, type DataKeyStore, type StoredDataKey } from "./data-keys.js";
export { VaultError } from "./errors.js";
export type { FieldAad } from "./internal/envelope.js";
