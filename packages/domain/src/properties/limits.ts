/**
 * Property, extraction, and refresh limits (feature 002 FR-017, FR-023, FR-035, FR-047,
 * research R12). Feature 011 replaces the pilot limits with plan limits.
 */

/** Active properties allowed on the Free plan, and in the pilot when Guidesk set no limit. */
export const FREE_PLAN_PROPERTY_LIMIT = 2;

/** The workspace's property limit: its pilot `property_limit`, or the Free plan's 2. */
export function propertyLimit(workspacePropertyLimit: number | null | undefined): number {
  return workspacePropertyLimit ?? FREE_PLAN_PROPERTY_LIMIT;
}

/** Extractions per workspace per UTC day: twice the property limit, at least 10 (FR-017). */
export function extractionLimit(limit: number): number {
  return Math.max(10, 2 * limit);
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
