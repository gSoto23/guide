import { and, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import {
  property,
  serviceRequest,
  serviceRequestDaily,
  stay,
  workspace,
  type Database,
} from "@guidesk/db";
import {
  JOB_QUEUES,
  localized,
  todayIn,
  type NotificationPushJob,
  type ServiceRequestStatus,
} from "@guidesk/domain";
import { renderServiceRequestNew } from "@guidesk/emails";
import type { EmailMessage } from "@guidesk/integrations";
import { loadAppliedSettings } from "./assistant-pipeline.js";
import { recipientsFor } from "./chat-reply.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Add-on requests, every minute (feature 008 research R5): expire waiting requests whose time passed,
 * cancel waiting requests of stays that are no longer active, and alert the property's escalation
 * contacts of new requests by email and push, waiting while the property is in quiet hours. Alerts
 * carry host content only (the extra's name, the date), never the guest's note (SEC-20).
 */
export const SERVICE_REQUEST_TICK_CRON = "* * * * *";
const BATCH = 200;

export interface ServiceRequestTickDeps {
  db: Database;
  queueEmail: (message: EmailMessage) => Promise<void>;
  queuePush?: (job: NotificationPushJob) => Promise<void>;
  portalUrl: string;
  now?: () => Date;
  span?: JobSpanDeps;
}

export interface ServiceRequestTickReport {
  expired: number;
  cancelled: number;
  notified: number;
  held: number;
}

async function count(
  db: Database,
  rows: { workspaceId: string; propertyId: string; timeZone: string | null }[],
  status: ServiceRequestStatus,
  now: Date,
): Promise<void> {
  for (const row of rows) {
    await db
      .insert(serviceRequestDaily)
      .values({
        workspaceId: row.workspaceId,
        propertyId: row.propertyId,
        day: todayIn(row.timeZone ?? "UTC", now),
        status,
        count: 1,
      })
      .onConflictDoUpdate({
        target: [
          serviceRequestDaily.propertyId,
          serviceRequestDaily.day,
          serviceRequestDaily.status,
        ],
        set: { count: sql`${serviceRequestDaily.count} + 1` },
      });
  }
}

async function zones(db: Database, propertyIds: string[]) {
  if (propertyIds.length === 0) return new Map<string, string | null>();
  const rows = await db
    .select({ id: property.id, timeZone: property.timeZone })
    .from(property)
    .where(inArray(property.id, [...new Set(propertyIds)]));
  return new Map(rows.map((row) => [row.id, row.timeZone]));
}

export async function runServiceRequestTick(
  deps: ServiceRequestTickDeps,
): Promise<ServiceRequestTickReport> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const report: ServiceRequestTickReport = { expired: 0, cancelled: 0, notified: 0, held: 0 };

  // 1. Expiry (FR-018).
  const expired = await db
    .update(serviceRequest)
    .set({ status: "expired" })
    .where(and(eq(serviceRequest.status, "waiting"), lte(serviceRequest.expiresAt, now)))
    .returning({ workspaceId: serviceRequest.workspaceId, propertyId: serviceRequest.propertyId });
  report.expired = expired.length;
  const expiredZones = await zones(
    db,
    expired.map((row) => row.propertyId),
  );
  await count(
    db,
    expired.map((row) => ({ ...row, timeZone: expiredZones.get(row.propertyId) ?? null })),
    "expired",
    now,
  );

  // 2. Stays that are no longer active cancel their waiting requests (FR-019).
  const ended = await db
    .select({ id: serviceRequest.id })
    .from(serviceRequest)
    .innerJoin(stay, eq(stay.id, serviceRequest.stayId))
    .where(and(eq(serviceRequest.status, "waiting"), ne(stay.status, "active")))
    .limit(BATCH);
  if (ended.length > 0) {
    const cancelled = await db
      .update(serviceRequest)
      .set({ status: "cancelled", reasonCode: "stay" })
      .where(
        and(
          inArray(
            serviceRequest.id,
            ended.map((row) => row.id),
          ),
          eq(serviceRequest.status, "waiting"),
        ),
      )
      .returning({
        workspaceId: serviceRequest.workspaceId,
        propertyId: serviceRequest.propertyId,
      });
    report.cancelled = cancelled.length;
    const cancelledZones = await zones(
      db,
      cancelled.map((row) => row.propertyId),
    );
    await count(
      db,
      cancelled.map((row) => ({ ...row, timeZone: cancelledZones.get(row.propertyId) ?? null })),
      "cancelled",
      now,
    );
  }

  // 3. Alerts for new requests (FR-015), once each, after quiet hours.
  const pending = await db
    .select({
      request: serviceRequest,
      propertyName: property.name,
      timeZone: property.timeZone,
      checkInDate: stay.checkInDate,
      checkoutDate: stay.checkoutDate,
    })
    .from(serviceRequest)
    .innerJoin(property, eq(property.id, serviceRequest.propertyId))
    .innerJoin(workspace, eq(workspace.id, serviceRequest.workspaceId))
    .innerJoin(stay, eq(stay.id, serviceRequest.stayId))
    .where(
      and(
        isNull(serviceRequest.notifiedAt),
        inArray(serviceRequest.status, ["waiting", "confirmed"]),
        eq(workspace.status, "active"),
      ),
    )
    .orderBy(serviceRequest.createdAt)
    .limit(BATCH);
  const settingsCache = new Map<string, Awaited<ReturnType<typeof loadAppliedSettings>>>();
  for (const row of pending) {
    const r = row.request;
    let applied = settingsCache.get(r.propertyId);
    if (!applied) {
      applied = await loadAppliedSettings(
        db,
        { workspaceId: r.workspaceId, propertyId: r.propertyId, timeZone: row.timeZone },
        now,
      );
      settingsCache.set(r.propertyId, applied);
    }
    if (applied.quiet.active) {
      report.held += 1;
      continue;
    }
    const claimed = await db
      .update(serviceRequest)
      .set({ notifiedAt: now })
      .where(and(eq(serviceRequest.id, r.id), isNull(serviceRequest.notifiedAt)))
      .returning({ id: serviceRequest.id });
    if (claimed.length === 0) continue;
    const recipients = await recipientsFor(
      db,
      r.workspaceId,
      applied.effective.contacts,
      "draft_ready",
    );
    for (const recipient of recipients) {
      const rendered = await renderServiceRequestNew(recipient.locale, {
        propertyName: row.propertyName,
        extraName: localized(r.extraName, recipient.locale, r.sourceLanguage).text,
        requestedDate: r.requestedDate,
        requestedTime: r.requestedTime ? r.requestedTime.slice(0, 5) : null,
        quantity: r.quantity,
        confirmed: r.status === "confirmed",
        stay: { checkInDate: row.checkInDate, checkoutDate: row.checkoutDate },
        requestsLink: `${deps.portalUrl}/${recipient.locale}/requests`,
      });
      await deps.queueEmail({ to: recipient.email, ...rendered, template: "service_request.new" });
      await deps.queuePush?.({
        userId: recipient.userId,
        kind: "service_request",
        workspaceId: r.workspaceId,
        propertyId: r.propertyId,
        requestId: r.id,
      });
    }
    report.notified += 1;
  }
  return report;
}

/** The pg-boss handler: one span per run with counts only (constitution VIII). */
export function createServiceRequestTickHandler(deps: ServiceRequestTickDeps) {
  return async (): Promise<void> => {
    await runInJobSpan(
      { queue: JOB_QUEUES.serviceRequestTick },
      async (span) => {
        const report = await runServiceRequestTick(deps);
        span.set({
          "job.outcome": "completed",
          "requests.expired": report.expired,
          "requests.cancelled": report.cancelled,
          "requests.notified": report.notified,
          "requests.held": report.held,
        });
      },
      deps.span,
    );
  };
}
