import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { pmsConnection, property, type Database } from "@guidesk/db";
import { JOB_QUEUES } from "@guidesk/domain";
import { renderPmsReconnect } from "@guidesk/emails";
import { PmsCredentialError, PmsProviderError, type EmailMessage } from "@guidesk/integrations";
import { notifyManagers } from "../notify.js";
import {
  addDays,
  applyReservations,
  loadConnection,
  pmsToday,
  type PmsJobDeps,
} from "./pms-common.js";
import type { Send } from "./calendar-refresh.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Read-only PMS refreshes (feature 002 FR-034, FR-035, T096). A cron every 15 minutes queues the
 * connections due (last refresh over 3 hours ago); "Refresh now" queues the same job at high
 * priority. Beds24 reads only what changed since the last refresh, plus a full read on the first
 * refresh of each day; Hostex always reads the full window. Core facts, listing content, and
 * manual stays are never touched (FR-034).
 */
export const PMS_SCHEDULE_QUEUE = "pms.refresh.schedule";
export const PMS_SCHEDULE_CRON = "*/15 * * * *";

const REFRESH_AFTER_MS = 3 * 60 * 60 * 1000;
const ALERT_AFTER_MS = 24 * 60 * 60 * 1000;
const STAY_WINDOW_DAYS = 365;
const PROVIDER_NAMES = { beds24: "Beds24", hostex: "Hostex" } as const;

export interface PmsRefreshJob {
  connectionId: string;
  workspaceId: string;
  /** "Refresh now" asks for a full read. */
  full?: boolean;
}

/** Queues every connection that is due. Disconnected connections are never queued. */
export function createPmsScheduler(deps: { db: Database; send: Send; now?: () => Date }) {
  return async (): Promise<number> => {
    const now = deps.now?.() ?? new Date();
    const due = await deps.db
      .select({ id: pmsConnection.id, workspaceId: pmsConnection.workspaceId })
      .from(pmsConnection)
      .where(
        and(
          ne(pmsConnection.status, "disconnected"),
          isNotNull(pmsConnection.credentialCiphertext),
          sql`coalesce(${pmsConnection.lastRefreshAt}, 'epoch') < ${new Date(now.getTime() - REFRESH_AFTER_MS)}`,
        ),
      );
    for (const connection of due) {
      await deps.send(
        JOB_QUEUES.pmsRefresh,
        {
          connectionId: connection.id,
          workspaceId: connection.workspaceId,
        } satisfies PmsRefreshJob,
        { singletonKey: `pms:${connection.id}` },
      );
    }
    return due.length;
  };
}

export interface PmsRefreshDeps extends PmsJobDeps {
  queueEmail: (message: EmailMessage) => Promise<void>;
  portalUrl: string;
  span?: JobSpanDeps;
}

export type PmsRefreshOutcome = "skipped" | "refreshed" | "failed";

export async function refreshPmsConnection(
  deps: PmsRefreshDeps,
  job: PmsRefreshJob,
): Promise<PmsRefreshOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const connection = await loadConnection(deps, job.workspaceId, job.connectionId);
  // A disconnected connection makes no request (AC-SEC-011).
  if (!connection?.credential) return "skipped";
  const linked = await db
    .select({ id: property.id, externalId: property.externalId })
    .from(property)
    .where(
      and(
        eq(property.pmsConnectionId, connection.id),
        eq(property.workspaceId, job.workspaceId),
        // Removed properties and listings gone from the PMS are not refreshed (AC-SEC-011).
        eq(property.status, "active"),
        or(eq(property.pmsStatus, "linked"), sql`${property.pmsStatus} IS NULL`),
        isNotNull(property.externalId),
      ),
    );
  if (linked.length === 0) {
    await db
      .update(pmsConnection)
      .set({ lastRefreshAt: now })
      .where(eq(pmsConnection.id, connection.id));
    return "skipped";
  }
  const adapter = deps.adapters[connection.provider];
  const fullRead =
    job.full === true ||
    connection.provider === "hostex" ||
    !connection.lastRefreshAt ||
    connection.lastRefreshAt.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);
  const today = pmsToday(now);
  try {
    let listingIds = linked.map((row) => row.externalId!);
    if (fullRead) {
      // A listing gone from the PMS is flagged, and its stays stop refreshing (edge cases).
      const listings = await adapter.listListings(connection.credential);
      const present = new Set(listings.map((listing) => listing.externalId));
      const gone = linked.filter((row) => !present.has(row.externalId!)).map((row) => row.id);
      if (gone.length > 0) {
        await db.update(property).set({ pmsStatus: "not_found" }).where(inArray(property.id, gone));
      }
      listingIds = listingIds.filter((id) => present.has(id));
    }
    const reservations =
      listingIds.length === 0
        ? []
        : await adapter.listReservations(connection.credential, {
            listingExternalIds: listingIds,
            checkoutFrom: today,
            checkoutTo: addDays(today, STAY_WINDOW_DAYS),
            ...(fullRead || !connection.lastRefreshAt
              ? {}
              : { modifiedSince: connection.lastRefreshAt }),
          });
    const propertyByListing = new Map(
      linked
        .filter((row) => listingIds.includes(row.externalId!))
        .map((row) => [row.externalId!, row.id] as const),
    );
    await applyReservations(db, {
      workspaceId: job.workspaceId,
      connectionId: connection.id,
      propertyByListing,
      reservations,
      today,
      fullRead,
      now,
    });
    await db
      .update(pmsConnection)
      .set({
        status: "active",
        lastRefreshAt: now,
        failingSince: null,
        alertedAt: null,
        lastErrorCode: null,
      })
      .where(eq(pmsConnection.id, connection.id));
    return "refreshed";
  } catch (error) {
    const code =
      error instanceof PmsCredentialError
        ? "invalid_credential"
        : error instanceof PmsProviderError
          ? error.code
          : "provider_error";
    const failingSince = connection.failingSince ?? now;
    // After 24 hours of failures, owners and admins get one email (FR-034).
    const alert = !connection.alertedAt && now.getTime() - failingSince.getTime() >= ALERT_AFTER_MS;
    await db
      .update(pmsConnection)
      .set({
        status: "failing",
        failingSince,
        lastErrorCode: code,
        // The schedule tries again in 3 hours, not every 15 minutes.
        lastRefreshAt: now,
        ...(alert ? { alertedAt: now } : {}),
      })
      .where(eq(pmsConnection.id, connection.id));
    if (alert) {
      await notifyManagers(
        db,
        deps.queueEmail,
        job.workspaceId,
        "properties.pms_reconnect",
        (locale) =>
          renderPmsReconnect(locale, {
            providerName: PROVIDER_NAMES[connection.provider],
            accountLabel: connection.accountLabel,
            lastRefreshAt: connection.lastRefreshAt,
            link: `${deps.portalUrl}/${locale}/settings/integrations`,
          }),
      );
    }
    return "failed";
  }
}

/** The pg-boss handler: one span per connection (constitution VIII). */
export function createPmsRefreshHandler(deps: PmsRefreshDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<PmsRefreshJob>;
      if (typeof data.connectionId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload: PmsRefreshJob = {
        connectionId: data.connectionId,
        workspaceId: data.workspaceId,
        full: data.full === true,
      };
      await runInJobSpan(
        { queue: JOB_QUEUES.pmsRefresh, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await refreshPmsConnection(deps, payload);
          span.set({ "job.outcome": outcome });
          if (outcome === "failed") span.recordFailure("pms_refresh_failed");
        },
        deps.span,
      );
    }
  };
}
