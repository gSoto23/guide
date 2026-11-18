import { and, eq } from "drizzle-orm";
import { property, pushSubscription, serviceRequest, user, type Database } from "@guidesk/db";
import { JOB_QUEUES, localized, type NotificationPushJob } from "@guidesk/domain";
import { renderPush, toEmailLocale, type ChatNeedsHostReason } from "@guidesk/emails";
import type { PushMessage, PushPort } from "@guidesk/integrations";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Push to a member's devices (feature 006 research R7, FR-016 to FR-018): renders the text in the
 * member's language from IDs and codes, sends to each registered device, and removes subscriptions
 * the push service reports as gone. Payloads carry no guest text (SEC-20).
 */
export interface NotificationPushDeps {
  db: Database;
  /** Null when the deployment has no VAPID keys: push is off, email still arrives. */
  push: PushPort | null;
  portalUrl: string;
  span?: JobSpanDeps;
}

export interface NotificationPushReport {
  sent: number;
  gone: number;
  failed: number;
}

const NONE: NotificationPushReport = { sent: 0, gone: 0, failed: 0 };

async function messageFor(
  deps: NotificationPushDeps,
  job: NotificationPushJob,
  locale: "es" | "en",
): Promise<PushMessage | null> {
  const base = deps.portalUrl.replace(/\/$/, "");
  if (job.kind === "test") {
    return { ...renderPush(locale, { kind: "test" }), url: `${base}/${locale}/inbox` };
  }
  if (!job.workspaceId || !job.propertyId) return null;
  const [prop] = await deps.db
    .select({ name: property.name })
    .from(property)
    .where(and(eq(property.id, job.propertyId), eq(property.workspaceId, job.workspaceId)))
    .limit(1);
  if (!prop) return null;
  if (job.kind === "quiet_summary") {
    return {
      ...renderPush(locale, {
        kind: "quiet_summary",
        propertyName: prop.name,
        count: job.count ?? 1,
      }),
      url: `${base}/${locale}/inbox?propertyId=${job.propertyId}`,
      tag: `summary-${job.propertyId}`,
    };
  }
  if (job.kind === "service_request") {
    if (!job.requestId) return null;
    // Feature 008 research R5: the extra's name from the stored request, never the guest's note.
    const [request] = await deps.db
      .select({
        extraName: serviceRequest.extraName,
        sourceLanguage: serviceRequest.sourceLanguage,
      })
      .from(serviceRequest)
      .where(
        and(
          eq(serviceRequest.id, job.requestId),
          eq(serviceRequest.workspaceId, job.workspaceId),
          eq(serviceRequest.propertyId, job.propertyId),
        ),
      )
      .limit(1);
    if (!request) return null;
    return {
      ...renderPush(locale, {
        kind: "service_request",
        propertyName: prop.name,
        extraName: localized(request.extraName, locale, request.sourceLanguage).text,
      }),
      url: `${base}/${locale}/requests`,
      tag: `request-${job.requestId}`,
    };
  }
  if (!job.conversationId || !job.reason) return null;
  return {
    ...renderPush(locale, {
      kind: "needs_host",
      propertyName: prop.name,
      reason: job.reason as ChatNeedsHostReason,
    }),
    url: `${base}/${locale}/properties/${job.propertyId}/conversations/${job.conversationId}`,
    tag: `conversation-${job.conversationId}`,
    urgency: job.reason === "emergency" || job.reason === "malfunction" ? "high" : "normal",
  };
}

export async function runNotificationPush(
  deps: NotificationPushDeps,
  job: NotificationPushJob,
): Promise<NotificationPushReport> {
  if (!deps.push) return NONE;
  const [member] = await deps.db
    .select({ preferredLanguage: user.preferredLanguage })
    .from(user)
    .where(eq(user.id, job.userId))
    .limit(1);
  if (!member) return NONE;
  const devices = await deps.db
    .select({
      id: pushSubscription.id,
      endpoint: pushSubscription.endpoint,
      p256dh: pushSubscription.p256dh,
      auth: pushSubscription.auth,
    })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, job.userId));
  if (devices.length === 0) return NONE;
  const message = await messageFor(deps, job, toEmailLocale(member.preferredLanguage));
  if (!message) return NONE;
  const report = { ...NONE };
  for (const device of devices) {
    const outcome = await deps.push.send(device, message);
    report[outcome] += 1;
    if (outcome === "gone") {
      await deps.db.delete(pushSubscription).where(eq(pushSubscription.id, device.id));
    } else if (outcome === "sent") {
      await deps.db
        .update(pushSubscription)
        .set({ lastSuccessAt: new Date() })
        .where(eq(pushSubscription.id, device.id));
    }
  }
  return report;
}

/** The pg-boss handler: one span per job with counts only. */
export function createNotificationPushHandler(deps: NotificationPushDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<NotificationPushJob>;
      if (typeof data.userId !== "string" || typeof data.kind !== "string") continue;
      await runInJobSpan(
        {
          queue: JOB_QUEUES.notificationPush,
          ...(data.workspaceId ? { workspaceId: data.workspaceId } : {}),
        },
        async (span) => {
          const report = await runNotificationPush(deps, data as NotificationPushJob);
          span.set({
            "job.sent": report.sent,
            "job.gone": report.gone,
            "job.failed": report.failed,
          });
        },
        deps.span,
      );
    }
  };
}
