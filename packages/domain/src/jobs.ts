/**
 * Worker queues shared by the API (which sends jobs) and the worker (which runs them)
 * (feature 002 research R13). Payloads carry IDs only, never restricted values.
 */
export const JOB_QUEUES = {
  extractionRun: "extraction.run",
  csvValidate: "csv.validate",
  csvImport: "csv.import",
  pmsImport: "pms.import",
  pmsRefresh: "pms.refresh",
  pmsListings: "pms.listings",
  pmsRevoke: "pms.revoke",
  calendarRefresh: "calendar.refresh",
  retentionDaily: "retention.daily",
  propertiesPurge: "properties.purge",
} as const;

export interface CalendarRefreshJob {
  feedId: string;
  workspaceId: string;
}

/** "Refresh now" runs ahead of scheduled refreshes (SC-006). */
export const REFRESH_NOW_PRIORITY = 10;

/**
 * pg-boss queue policies. `stately` keeps at most one queued and one active job per singleton
 * key, so one feed or connection never refreshes twice at the same time (research R8). The API
 * and the worker both create queues with these policies, whichever starts first.
 */
export const QUEUE_POLICIES: Partial<
  Record<string, "standard" | "stately" | "singleton" | "short">
> = {
  [JOB_QUEUES.calendarRefresh]: "stately",
  [JOB_QUEUES.pmsRefresh]: "stately",
  [JOB_QUEUES.pmsImport]: "singleton",
};
