/**
 * Guide builder limits (feature 003 FR-018, FR-064, FR-065, research R6, R9). Feature 011 replaces
 * the pilot limits with plan limits.
 */

/** Guide AI requests per workspace per UTC day: the pilot override, else 50 per allowed property, at least 100. */
export function guideAiDailyLimit(propertyLimit: number, override?: number | null): number {
  return override ?? Math.max(100, 50 * propertyLimit);
}

/** The `rate_limit_bucket` key that counts a workspace's guide AI requests for one UTC day. */
export function guideAiLimitKey(workspaceId: string, now: Date): string {
  return `guide-ai:${workspaceId}:${now.toISOString().slice(0, 10)}`;
}

/** When the daily guide AI count starts again: the next UTC midnight. */
export function guideAiLimitResetsAt(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

const MEBIBYTE = 1024 * 1024;

/** Media storage per workspace in bytes: the pilot override in MB, else 1 GB per allowed property. */
export function mediaStorageLimitBytes(propertyLimit: number, overrideMb?: number | null): number {
  return (overrideMb ?? 1024 * propertyLimit) * MEBIBYTE;
}

/** Locked-field reveals per member per hour (FR-018). */
export const REVEAL_LIMIT_PER_HOUR = 20;
export const REVEAL_WINDOW_SECONDS = 3600;

/** The `rate_limit_bucket` key that counts one member's reveals in a workspace. */
export function revealLimitKey(workspaceId: string, userId: string): string {
  return `reveal:${workspaceId}:${userId}`;
}

/** File limits (FR-009, FR-039). */
export const IMAGE_MAX_BYTES = 10 * MEBIBYTE;
export const VIDEO_MAX_BYTES = 150 * MEBIBYTE;
export const VIDEO_MAX_DURATION_MS = 90_000;
export const DOCUMENT_MAX_BYTES = 20 * MEBIBYTE;
export const DOCUMENT_MAX_PAGES = 60;
export const DOCUMENTS_PER_UPLOAD = 10;
export const VOICE_MAX_BYTES = 10 * MEBIBYTE;
export const VOICE_MAX_SECONDS = 120;
export const ANSWER_MAX_LENGTH = 2_000;
export const LOCKED_VALUE_MAX_LENGTH = 200;
export const MAX_SHARED_BLOCKS = 50;
/** Published versions kept per guide (FR-055). */
export const VERSIONS_KEPT = 20;
