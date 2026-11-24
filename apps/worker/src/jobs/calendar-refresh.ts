import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { calendarFeed, property, stay, workspace, type Database } from "@guidesk/db";
import {
  feedChannelName,
  JOB_QUEUES,
  markDuplicates,
  planFeedRefresh,
  todayIn,
  type CalendarRefreshJob,
} from "@guidesk/domain";
import { renderFeedFailing } from "@guidesk/emails";
import type { EmailMessage, SandboxPort } from "@guidesk/integrations";
import { createDataKeyStore } from "@guidesk/vault";
import type { VaultDecrypter } from "@guidesk/vault/decrypt";
import { notifyManagers } from "../notify.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Calendar feed refreshes (feature 002 FR-023, FR-024, research R8, T077). A cron every 15
 * minutes queues the feeds due (last success over 3 hours ago), spread over the next 10 minutes
 * by feed ID; "Refresh now" queues the same job at high priority from the API. The `stately`
 * queue policy and a singleton key per feed keep one feed from running twice at once.
 */
export const CALENDAR_SCHEDULE_QUEUE = "calendar.refresh.schedule";
export const CALENDAR_SCHEDULE_CRON = "*/15 * * * *";

const REFRESH_AFTER_MS = 3 * 60 * 60 * 1000;
/** A failing feed is tried again on the next tick, not every minute. */
const RETRY_AFTER_MS = 15 * 60 * 1000;
const ALERT_AFTER_MS = 24 * 60 * 60 * 1000;
const SPREAD_SECONDS = 600;

export type Send = (
  queue: string,
  data: object,
  options: { singletonKey?: string; startAfter?: number; priority?: number },
) => Promise<unknown>;

/** Seconds to wait before a feed's scheduled refresh, stable per feed, so reads spread out. */
export function spreadOf(feedId: string): number {
  return createHash("sha256").update(feedId).digest().readUInt32BE(0) % SPREAD_SECONDS;
}

/** Queues every feed that is due. Removed properties and workspaces pending deletion are skipped. */
export function createCalendarScheduler(deps: { db: Database; send: Send; now?: () => Date }) {
  return async (): Promise<number> => {
    const now = deps.now?.() ?? new Date();
    const due = await deps.db
      .select({ id: calendarFeed.id, workspaceId: calendarFeed.workspaceId })
      .from(calendarFeed)
      .innerJoin(property, eq(property.id, calendarFeed.propertyId))
      .innerJoin(workspace, eq(workspace.id, calendarFeed.workspaceId))
      .where(
        and(
          eq(property.status, "active"),
          eq(workspace.status, "active"),
          sql`coalesce(${calendarFeed.lastSuccessAt}, 'epoch') < ${new Date(now.getTime() - REFRESH_AFTER_MS)}`,
          sql`coalesce(${calendarFeed.lastAttemptAt}, 'epoch') < ${new Date(now.getTime() - RETRY_AFTER_MS)}`,
        ),
      );
    for (const feed of due) {
      await deps.send(
        JOB_QUEUES.calendarRefresh,
        { feedId: feed.id, workspaceId: feed.workspaceId } satisfies CalendarRefreshJob,
        {
          singletonKey: `feed:${feed.id}`,
          startAfter: spreadOf(feed.id),
        },
      );
    }
    return due.length;
  };
}

export interface CalendarRefreshDeps {
  db: Database;
  decrypter: VaultDecrypter;
  sandbox: SandboxPort;
  queueEmail: (message: EmailMessage) => Promise<void>;
  portalUrl: string;
  now?: () => Date;
  span?: JobSpanDeps;
}

export type RefreshOutcome = "skipped" | "not_modified" | "refreshed" | "failed";

/**
 * Reads one feed and applies it to its stays. A failed read keeps the last known stays and marks
 * the feed failing; after 24 hours of failures, owners and admins get one email (FR-024). Feeds of
 * removed properties make no request (AC-SEC-011).
 */
export async function refreshFeed(
  deps: CalendarRefreshDeps,
  job: CalendarRefreshJob,
): Promise<RefreshOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const [feed] = await db
    .select({
      id: calendarFeed.id,
      workspaceId: calendarFeed.workspaceId,
      propertyId: calendarFeed.propertyId,
      channel: calendarFeed.channel,
      channelLabel: calendarFeed.channelLabel,
      urlCiphertext: calendarFeed.urlCiphertext,
      dataKeyId: calendarFeed.dataKeyId,
      etag: calendarFeed.etag,
      lastModified: calendarFeed.lastModified,
      lastSuccessAt: calendarFeed.lastSuccessAt,
      failingSince: calendarFeed.failingSince,
      alertedAt: calendarFeed.alertedAt,
      propertyName: property.name,
      propertyStatus: property.status,
      timeZone: property.timeZone,
      workspaceStatus: workspace.status,
    })
    .from(calendarFeed)
    .innerJoin(property, eq(property.id, calendarFeed.propertyId))
    .innerJoin(workspace, eq(workspace.id, calendarFeed.workspaceId))
    .where(and(eq(calendarFeed.id, job.feedId), eq(calendarFeed.workspaceId, job.workspaceId)))
    .limit(1);
  if (!feed || feed.propertyStatus !== "active" || feed.workspaceStatus !== "active")
    return "skipped";

  const url = await deps.decrypter.decryptText(
    createDataKeyStore(db),
    {
      workspaceId: feed.workspaceId,
      table: "calendar_feed",
      column: "url_ciphertext",
      rowId: feed.id,
      dataKeyId: feed.dataKeyId,
    },
    feed.urlCiphertext,
  );
  const read = await deps.sandbox.readFeed({
    url,
    ...(feed.etag ? { etag: feed.etag } : {}),
    ...(feed.lastModified ? { lastModified: feed.lastModified } : {}),
  });

  if ("error" in read) {
    const failingSince = feed.failingSince ?? now;
    const alert = !feed.alertedAt && now.getTime() - failingSince.getTime() >= ALERT_AFTER_MS;
    await db
      .update(calendarFeed)
      .set({
        status: "failing",
        lastAttemptAt: now,
        failingSince,
        lastErrorCode: read.error,
        ...(alert ? { alertedAt: now } : {}),
      })
      .where(eq(calendarFeed.id, feed.id));
    if (alert) {
      const channelName = feedChannelName(feed.channel, feed.channelLabel);
      await notifyManagers(
        db,
        deps.queueEmail,
        feed.workspaceId,
        "properties.feed_failing",
        (locale) =>
          renderFeedFailing(locale, {
            propertyName: feed.propertyName,
            channelName,
            lastSuccessAt: feed.lastSuccessAt,
            link: `${deps.portalUrl}/${locale}/properties/${feed.propertyId}`,
          }),
      );
    }
    return "failed";
  }

  const success = {
    status: "active" as const,
    lastSuccessAt: now,
    lastAttemptAt: now,
    failingSince: null,
    alertedAt: null,
    lastErrorCode: null,
    etag: read.etag ?? feed.etag,
    lastModified: read.lastModified ?? feed.lastModified,
  };
  if ("notModified" in read) {
    await db.update(calendarFeed).set(success).where(eq(calendarFeed.id, feed.id));
    return "not_modified";
  }

  const existing = await db
    .select({
      id: stay.id,
      externalUid: stay.externalUid,
      checkInDate: stay.checkInDate,
      checkoutDate: stay.checkoutDate,
      status: stay.status,
      mayBeBlock: stay.mayBeBlock,
      bookingReference: stay.bookingReference,
    })
    .from(stay)
    .where(eq(stay.calendarFeedId, feed.id));
  const plan = planFeedRefresh({
    today: todayIn(feed.timeZone ?? "UTC", now),
    existing: existing.map((row) => ({ ...row, externalUid: row.externalUid ?? "" })),
    entries: read.entries,
  });
  const channel = feedChannelName(feed.channel, feed.channelLabel);

  await db.transaction(async (tx) => {
    if (plan.create.length > 0) {
      await tx.insert(stay).values(
        plan.create.map((entry) => ({
          workspaceId: feed.workspaceId,
          propertyId: feed.propertyId,
          source: "ical" as const,
          calendarFeedId: feed.id,
          externalUid: entry.externalUid,
          checkInDate: entry.checkInDate,
          checkoutDate: entry.checkoutDate,
          channel,
          mayBeBlock: entry.mayBeBlock,
          bookingReference: entry.bookingReference,
          lastSeenAt: now,
        })),
      );
    }
    for (const change of plan.update) {
      await tx
        .update(stay)
        .set({
          checkInDate: change.checkInDate,
          checkoutDate: change.checkoutDate,
          mayBeBlock: change.mayBeBlock,
          bookingReference: change.bookingReference,
          status: "active",
          cancelledAt: null,
          lastSeenAt: now,
        })
        .where(eq(stay.id, change.id));
    }
    if (plan.cancel.length > 0) {
      await tx
        .update(stay)
        .set({ status: "cancelled", cancelledAt: now })
        .where(inArray(stay.id, plan.cancel));
    }
    const seen = new Set(read.entries.map((entry) => entry.uid));
    const stillThere = existing
      .filter((row) => row.externalUid && seen.has(row.externalUid))
      .map((row) => row.id);
    if (stillThere.length > 0) {
      await tx.update(stay).set({ lastSeenAt: now }).where(inArray(stay.id, stillThere));
    }
    await tx.update(calendarFeed).set(success).where(eq(calendarFeed.id, feed.id));
    await reconcileDuplicates(tx as unknown as Database, feed.propertyId);
  });
  return "refreshed";
}

/** Applies the duplicate marks for a property's feed and PMS stays (edge cases, R8). */
export async function reconcileDuplicates(db: Database, propertyId: string): Promise<void> {
  const stays = await db
    .select({
      id: stay.id,
      source: stay.source,
      calendarFeedId: stay.calendarFeedId,
      checkInDate: stay.checkInDate,
      checkoutDate: stay.checkoutDate,
      mayBeBlock: stay.mayBeBlock,
      status: stay.status,
      duplicateOfId: stay.duplicateOfId,
    })
    .from(stay)
    .where(eq(stay.propertyId, propertyId));
  for (const change of markDuplicates(stays)) {
    await db
      .update(stay)
      .set({ duplicateOfId: change.duplicateOfId })
      .where(eq(stay.id, change.id));
  }
}

/** The pg-boss handler: one span per feed (constitution VIII). */
export function createCalendarRefreshHandler(deps: CalendarRefreshDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<CalendarRefreshJob>;
      if (typeof data.feedId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload = { feedId: data.feedId, workspaceId: data.workspaceId };
      await runInJobSpan(
        { queue: JOB_QUEUES.calendarRefresh, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await refreshFeed(deps, payload);
          span.set({ "job.outcome": outcome });
          if (outcome === "failed") span.recordFailure("feed_read_failed");
        },
        deps.span,
      );
    }
  };
}
