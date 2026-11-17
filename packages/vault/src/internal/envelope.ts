/**
 * Stored format and additional authenticated data for restricted values (research R5, SEC-06),
 * shared by the encrypt and decrypt entry points. Not exported from the package.
 */
import { VaultError } from "../errors.js";

export const CIPHER = "aes-256-gcm";
export const FORMAT_VERSION = 0x01;
export const KEY_BYTES = 32;
/** 96-bit random IV, the GCM recommendation. */
export const IV_BYTES = 12;
export const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES;

/**
 * Where a restricted value lives. All four parts are bound into the GCM tag, so a ciphertext
 * copied to another row, column, table, or workspace fails to decrypt.
 */
export interface FieldAad {
  workspaceId: string;
  /** Table name, for example `pms_connection`. */
  table: string;
  /** Column name, for example `credential_ciphertext`. */
  column: string;
  /** ID of the row that holds the value; generate it before encrypting. */
  rowId: string;
}

/** `workspace_id|table|column|row_id` as UTF-8 bytes. */
export function aadBytes(aad: FieldAad): Buffer {
  const parts = [aad.workspaceId, aad.table, aad.column, aad.rowId];
  // An empty part or a separator inside a part would let two locations share one AAD.
  if (parts.some((part) => typeof part !== "string" || part.length === 0 || part.includes("|"))) {
    throw new VaultError("Restricted value location must have four non-empty parts without '|'");
  }
  return Buffer.from(parts.join("|"), "utf8");
}

export interface Envelope {
  iv: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

/** `version || iv || ciphertext || tag`. */
export function packEnvelope({ iv, ciphertext, tag }: Envelope): Buffer {
  return Buffer.concat([Buffer.of(FORMAT_VERSION), iv, ciphertext, tag]);
}

export function unpackEnvelope(stored: Buffer): Envelope {
  if (stored.length < HEADER_BYTES + TAG_BYTES || stored[0] !== FORMAT_VERSION) {
    throw new VaultError("Restricted value has an unknown format");
  }
  return {
    iv: stored.subarray(1, HEADER_BYTES),
    ciphertext: stored.subarray(HEADER_BYTES, stored.length - TAG_BYTES),
    tag: stored.subarray(stored.length - TAG_BYTES),
  };
}
