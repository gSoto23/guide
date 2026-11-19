/**
 * Extraction and refresh limits (feature 002 FR-017, FR-023, FR-035). The property limit itself
 * comes from the workspace's plan (feature 011, `plans/`).
 */

/**
 * Extractions per workspace per UTC day: twice the limit basis (the property limit, or for
 * unlimited plans the active properties plus 2), at least 10 (FR-017, feature 011 FR-005).
 */
export function extractionLimit(basis: number): number {
  return Math.max(10, 2 * basis);
}

/** When the daily extraction count starts again: the next UTC midnight. */
export function extractionLimitResetsAt(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** "Refresh now" runs at most once every 5 minutes per property feed set or PMS connection. */
export const REFRESH_NOW_INTERVAL_MS = 5 * 60 * 1000;

export function refreshAllowed(lastManualRefreshAt: Date | null | undefined, now: Date): boolean {
  return (
    !lastManualRefreshAt || now.getTime() - lastManualRefreshAt.getTime() >= REFRESH_NOW_INTERVAL_MS
  );
}

export function nextRefreshAllowedAt(lastManualRefreshAt: Date): Date {
  return new Date(lastManualRefreshAt.getTime() + REFRESH_NOW_INTERVAL_MS);
}

/** The `rate_limit_bucket` key that counts a workspace's extractions for one UTC day (FR-017). */
export function extractionLimitKey(workspaceId: string, now: Date): string {
  return `extraction:${workspaceId}:${now.toISOString().slice(0, 10)}`;
}
