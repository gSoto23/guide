import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, sql } from "drizzle-orm";
import type {
  CalendarFeed,
  CalendarFeedList,
  CreateCalendarFeedBody,
  CreatedCalendarFeed,
  UpdateCalendarFeedBody,
} from "@guidesk/contracts";
import { calendarFeed, stay } from "@guidesk/db";
import {
  detectChannel,
  feedDisplayHint,
  JOB_QUEUES,
  normalizeFeedUrl,
  planFeedRefresh,
  REFRESH_NOW_INTERVAL_MS,
  REFRESH_NOW_PRIORITY,
  todayIn,
  type CalendarRefreshJob,
  type FeedChannel,
  type Role,
} from "@guidesk/domain";
import type { FeedReadResponse, SandboxPort } from "@guidesk/integrations";
import { createDataKeyStore, type Vault } from "@guidesk/vault";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import {
  FEED_FINGERPRINT,
  SANDBOX,
  VAULT,
  type FeedFingerprint,
} from "../integrations/integrations.module.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { PropertiesService } from "../properties/properties.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";

interface Caller {
  userId: string;
  role: Role;
}

/** Every column a request may read; the link ciphertext is never selected (FR-025). */
const FEED_COLUMNS = {
  id: calendarFeed.id,
  propertyId: calendarFeed.propertyId,
  channel: calendarFeed.channel,
  channelLabel: calendarFeed.channelLabel,
  urlFingerprint: calendarFeed.urlFingerprint,
  displayHint: calendarFeed.displayHint,
  status: calendarFeed.status,
  lastSuccessAt: calendarFeed.lastSuccessAt,
  lastAttemptAt: calendarFeed.lastAttemptAt,
  failingSince: calendarFeed.failingSince,
  lastErrorCode: calendarFeed.lastErrorCode,
  manualRefreshAt: calendarFeed.manualRefreshAt,
  createdAt: calendarFeed.createdAt,
};

type FeedRow = {
  [K in keyof typeof FEED_COLUMNS]: (typeof FEED_COLUMNS)[K]["_"]["data"] | null;
} & {
  id: string;
  propertyId: string;
  channel: FeedChannel;
  createdAt: Date;
};

const CHANNEL_NAMES: Record<Exclude<FeedChannel, "other">, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  vrbo: "Vrbo",
};

/** The channel name stays carry: the OTA's name, or the host's label for another channel. */
export function channelName(channel: FeedChannel, label: string | null): string {
  return channel === "other" ? (label ?? "Other").slice(0, 40) : CHANNEL_NAMES[channel];
}

function toFeed(row: FeedRow): CalendarFeed {
  return {
    id: row.id,
    propertyId: row.propertyId,
    channel: row.channel,
    channelLabel: row.channelLabel ?? null,
    displayHint: row.displayHint ?? "…",
    status: row.status ?? "active",
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    failingSince: row.failingSince?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function rejected(read: FeedReadResponse): ApiProblem | null {
  if ("error" in read) {
    return new ApiProblem(422, "feed_rejected", "We couldn't read that calendar link.", {
      details: { reason: read.error },
    });
  }
  if ("notModified" in read) {
    return new ApiProblem(422, "feed_rejected", undefined, { details: { reason: "internal" } });
  }
  return null;
}

/** Maps the database's guards to the contract's errors (FR-020). */
function translateWriteError(error: unknown): never {
  const cause = (error as { cause?: { code?: string; constraint?: string; message?: string } })
    .cause;
  if (cause?.code === "23505") {
    const reason =
      cause.constraint === "calendar_feed_fingerprint_uq" ? "same_link" : "same_channel";
    throw new ApiProblem(409, "duplicate_feed", undefined, { details: { reason } });
  }
  if (cause?.code === "23514" && cause.message?.startsWith("feed_limit_reached")) {
    throw new ApiProblem(409, "feed_limit_reached");
  }
  throw error;
}

/**
 * Calendar feeds (US3, T075). A link is read through the isolated feed reader before anything is
 * stored (FR-021), kept only as ciphertext bound to its row, and shown as a masked hint (FR-025).
 */
@Injectable()
export class CalendarFeedsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly properties: PropertiesService,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
    private readonly jobs: JobQueueService,
    @Inject(SANDBOX) private readonly sandbox: SandboxPort,
    @Inject(VAULT) private readonly vault: Vault,
    @Inject(FEED_FINGERPRINT) private readonly fingerprint: FeedFingerprint,
  ) {}

  private async feedsOf(propertyId: string): Promise<FeedRow[]> {
    return (await this.requestDb
      .current()
      .select(FEED_COLUMNS)
      .from(calendarFeed)
      .where(eq(calendarFeed.propertyId, propertyId))
      .orderBy(calendarFeed.createdAt)) as FeedRow[];
  }

  private async loadFeed(caller: Caller, workspaceId: string, feedId: string): Promise<FeedRow> {
    const [row] = (await this.requestDb
      .current()
      .select(FEED_COLUMNS)
      .from(calendarFeed)
      .where(and(eq(calendarFeed.id, feedId), eq(calendarFeed.workspaceId, workspaceId)))
      .limit(1)) as FeedRow[];
    if (!row)
      throw await this.crossTenant.notFound(caller.userId, workspaceId, "calendar_feed", feedId);
    return row;
  }

  async list(caller: Caller, workspaceId: string, propertyId: string): Promise<CalendarFeedList> {
    await this.properties.load(caller, workspaceId, propertyId);
    return { items: (await this.feedsOf(propertyId)).map(toFeed) };
  }

  /** Same link twice, or a second feed for the same channel (FR-020). */
  private assertNotDuplicate(
    feeds: FeedRow[],
    channel: FeedChannel,
    label: string | null,
    fingerprint: string,
    exceptId?: string,
  ): void {
    const others = feeds.filter((feed) => feed.id !== exceptId);
    if (others.some((feed) => feed.urlFingerprint === fingerprint)) {
      throw new ApiProblem(409, "duplicate_feed", undefined, { details: { reason: "same_link" } });
    }
    const sameChannel =
      channel === "other"
        ? others.some((feed) => feed.channel === "other" && feed.channelLabel === label)
        : others.some((feed) => feed.channel === channel);
    if (sameChannel) {
      throw new ApiProblem(409, "duplicate_feed", undefined, {
        details: { reason: "same_channel" },
      });
    }
  }

  async create(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    body: CreateCalendarFeedBody,
  ): Promise<CreatedCalendarFeed> {
    const property = await this.properties.load(caller, workspaceId, propertyId);
    if (property.status !== "active") throw new ApiProblem(404, "not_found");
    const channel = body.channel ?? detectChannel(body.url);
    const label = channel === "other" ? (body.channelLabel ?? null) : null;
    if (channel === "other" && !label) {
      throw new ApiProblem(422, "validation_failed", "Name the channel.", {
        fields: { channelLabel: ["Required for another channel"] },
      });
    }
    const normalized = normalizeFeedUrl(body.url);
    if (!normalized)
      throw new ApiProblem(422, "feed_rejected", undefined, { details: { reason: "not_https" } });
    const fingerprint = this.fingerprint(normalized);
    const feeds = await this.feedsOf(propertyId);
    this.assertNotDuplicate(feeds, channel, label, fingerprint);
    if (feeds.length >= 5) throw new ApiProblem(409, "feed_limit_reached");

    // Nothing is stored unless the link reads as a calendar (FR-021).
    const read = await this.sandbox.readFeed({ url: body.url });
    const problem = rejected(read);
    if (problem || !("entries" in read)) throw problem ?? new ApiProblem(422, "feed_rejected");

    const tx = this.requestDb.current();
    const id = randomUUID();
    const now = new Date();
    const { ciphertext, dataKeyId } = await this.vault.encrypt(
      createDataKeyStore(tx),
      { workspaceId, table: "calendar_feed", column: "url_ciphertext", rowId: id },
      body.url,
    );
    let row: FeedRow;
    try {
      [row] = (await tx
        .insert(calendarFeed)
        .values({
          id,
          workspaceId,
          propertyId,
          channel,
          channelLabel: label,
          urlCiphertext: ciphertext,
          urlFingerprint: fingerprint,
          displayHint: feedDisplayHint(body.url),
          dataKeyId,
          lastSuccessAt: now,
          lastAttemptAt: now,
          etag: read.etag,
          lastModified: read.lastModified,
          createdBy: caller.userId,
        })
        .returning(FEED_COLUMNS)) as [FeedRow];
    } catch (error) {
      translateWriteError(error);
    }

    const plan = planFeedRefresh({
      today: todayIn(property.timeZone ?? "UTC", now),
      existing: [],
      entries: read.entries,
    });
    if (plan.create.length > 0) {
      await tx.insert(stay).values(
        plan.create.map((entry) => ({
          workspaceId,
          propertyId,
          source: "ical" as const,
          calendarFeedId: id,
          externalUid: entry.externalUid,
          checkInDate: entry.checkInDate,
          checkoutDate: entry.checkoutDate,
          channel: channelName(channel, label),
          mayBeBlock: entry.mayBeBlock,
          lastSeenAt: now,
        })),
      );
    }
    await this.securityLog.record({
      type: "calendar_feed.added",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "calendar_feed",
      targetId: id,
      metadata: { channel },
    });
    return {
      ...toFeed(row),
      upcomingStays: plan.create.map((entry) => ({
        checkInDate: entry.checkInDate,
        checkoutDate: entry.checkoutDate,
        mayBeBlock: entry.mayBeBlock,
      })),
    };
  }

  async update(
    caller: Caller,
    workspaceId: string,
    feedId: string,
    body: UpdateCalendarFeedBody,
  ): Promise<CalendarFeed> {
    const feed = await this.loadFeed(caller, workspaceId, feedId);
    const tx = this.requestDb.current();
    const changes: Partial<typeof calendarFeed.$inferInsert> = {};
    const label = body.channelLabel ?? feed.channelLabel ?? null;
    if (body.channelLabel !== undefined) {
      if (feed.channel !== "other") {
        throw new ApiProblem(422, "validation_failed", "Only another channel has a label.", {
          fields: { channelLabel: ["Not allowed for this channel"] },
        });
      }
      changes.channelLabel = body.channelLabel;
    }
    if (body.url !== undefined) {
      const normalized = normalizeFeedUrl(body.url);
      if (!normalized)
        throw new ApiProblem(422, "feed_rejected", undefined, { details: { reason: "not_https" } });
      const fingerprint = this.fingerprint(normalized);
      this.assertNotDuplicate(
        await this.feedsOf(feed.propertyId),
        feed.channel,
        label,
        fingerprint,
        feed.id,
      );
      const read = await this.sandbox.readFeed({ url: body.url });
      const problem = rejected(read);
      if (problem) throw problem;
      const { ciphertext, dataKeyId } = await this.vault.encrypt(
        createDataKeyStore(tx),
        { workspaceId, table: "calendar_feed", column: "url_ciphertext", rowId: feed.id },
        body.url,
      );
      Object.assign(changes, {
        urlCiphertext: ciphertext,
        urlFingerprint: fingerprint,
        displayHint: feedDisplayHint(body.url),
        dataKeyId,
        status: "active",
        failingSince: null,
        alertedAt: null,
        lastErrorCode: null,
        etag: null,
        lastModified: null,
      });
    }
    let row: FeedRow;
    try {
      [row] = (await tx
        .update(calendarFeed)
        .set(changes)
        .where(and(eq(calendarFeed.id, feed.id), eq(calendarFeed.workspaceId, workspaceId)))
        .returning(FEED_COLUMNS)) as [FeedRow];
    } catch (error) {
      translateWriteError(error);
    }
    if (body.url !== undefined) {
      // The worker applies the new link's stays once this request has committed.
      await this.jobs.send(
        JOB_QUEUES.calendarRefresh,
        { feedId: feed.id, workspaceId } satisfies CalendarRefreshJob,
        { priority: REFRESH_NOW_PRIORITY, singletonKey: `feed:${feed.id}`, startAfter: 2 },
      );
    }
    await this.securityLog.record({
      type: "calendar_feed.changed",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "calendar_feed",
      targetId: feed.id,
      metadata: { channel: feed.channel },
    });
    return toFeed(row);
  }

  async remove(caller: Caller, workspaceId: string, feedId: string): Promise<void> {
    const feed = await this.loadFeed(caller, workspaceId, feedId);
    // Its stays go with it (foreign key ON DELETE CASCADE).
    await this.requestDb
      .current()
      .delete(calendarFeed)
      .where(and(eq(calendarFeed.id, feed.id), eq(calendarFeed.workspaceId, workspaceId)));
    await this.securityLog.record({
      type: "calendar_feed.removed",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "calendar_feed",
      targetId: feed.id,
      metadata: { channel: feed.channel },
    });
  }

  /** "Refresh now" for every feed of the property, once every 5 minutes (FR-023). */
  async refreshNow(caller: Caller, workspaceId: string, propertyId: string): Promise<void> {
    await this.properties.load(caller, workspaceId, propertyId);
    const tx = this.requestDb.current();
    const now = new Date();
    const [recent] = await tx
      .select({ last: sql<Date>`max(${calendarFeed.manualRefreshAt})` })
      .from(calendarFeed)
      .where(
        and(
          eq(calendarFeed.propertyId, propertyId),
          gt(calendarFeed.manualRefreshAt, new Date(now.getTime() - REFRESH_NOW_INTERVAL_MS)),
        ),
      );
    if (recent?.last) {
      const retryAfterSeconds = Math.ceil(
        (new Date(recent.last).getTime() + REFRESH_NOW_INTERVAL_MS - now.getTime()) / 1000,
      );
      throw new ApiProblem(409, "refresh_too_soon", undefined, {
        details: { retryAfterSeconds },
        retryAfterSeconds,
      });
    }
    const feeds = await tx
      .update(calendarFeed)
      .set({ manualRefreshAt: now })
      .where(eq(calendarFeed.propertyId, propertyId))
      .returning({ id: calendarFeed.id });
    for (const feed of feeds) {
      await this.jobs.send(
        JOB_QUEUES.calendarRefresh,
        { feedId: feed.id, workspaceId } satisfies CalendarRefreshJob,
        { priority: REFRESH_NOW_PRIORITY, singletonKey: `feed:${feed.id}` },
      );
    }
  }
}
