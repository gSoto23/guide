/**
 * Object storage for uploads (feature 002, research R9, SEC-10, SEC-11). Browsers upload
 * straight to the bucket with presigned POST forms; no file bytes pass through the API.
 */
export interface PresignedPostInput {
  /** `uploads/{workspace_id}/{upload_id}`; never derived from the file name. */
  key: string;
  contentType: string;
  maxBytes: number;
}

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
  expiresAt: Date;
}

/** Presigned forms expire after 10 minutes (research R9). */
export const PRESIGNED_POST_TTL_SECONDS = 600;

export interface ObjectStoragePort {
  /** A form that only accepts this key, this content type, and at most `maxBytes`. */
  createPresignedPost(input: PresignedPostInput): Promise<PresignedPost>;
  /** The object's bytes, or null when it does not exist. */
  get(key: string): Promise<Buffer | null>;
  /** Deletes the object; deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
  /**
   * The malware scan result GuardDuty tagged on the object (feature 003 research R9): `pending`
   * before the tag appears, `unscanned` where there is no scanner (local storage).
   */
  scanStatus(key: string): Promise<ScanStatus>;
}

export type ScanStatus = "clean" | "threats" | "failed" | "pending" | "unscanned";
