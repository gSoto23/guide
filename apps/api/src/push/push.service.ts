import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { PushStatus, PushSubscriptionBody } from "@guidesk/contracts";
import { pushSubscription, type DbHandle } from "@guidesk/db";
import { JOB_QUEUES, type NotificationPushJob } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";

const TESTS_PER_HOUR = 5;

/**
 * A member's push devices (feature 006 research R7, FR-015, FR-018). Subscriptions belong to the
 * user, not a workspace; reads and deletes run under RLS. The upsert by endpoint runs in the system
 * context because an endpoint moves to whoever signs in on that browser.
 */
@Injectable()
export class PushService {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    private readonly requestDb: RequestDb,
    private readonly jobs: JobQueueService,
    private readonly rateLimit: RateLimitService,
    private readonly securityLog: SecurityLogService,
  ) {}

  private get push() {
    return this.config.integrations.push;
  }

  async status(): Promise<PushStatus> {
    const devices = await this.requestDb
      .current()
      .select({
        id: pushSubscription.id,
        device: pushSubscription.device,
        createdAt: pushSubscription.createdAt,
      })
      .from(pushSubscription)
      .orderBy(pushSubscription.createdAt);
    return {
      available: this.push !== null,
      publicKey: this.push?.publicKey ?? null,
      devices: devices.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    };
  }

  async subscribe(userId: string, body: PushSubscriptionBody): Promise<{ id: string }> {
    if (!this.push) throw new ApiProblem(503, "push_unavailable");
    const [row] = await this.handle.db
      .insert(pushSubscription)
      .values({
        userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        device: body.device,
      })
      .onConflictDoUpdate({
        target: pushSubscription.endpoint,
        set: {
          userId,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          device: body.device,
          lastSuccessAt: null,
        },
      })
      .returning({ id: pushSubscription.id });
    await this.securityLog.record({
      type: "push.subscribed",
      outcome: "success",
      actorUserId: userId,
      metadata: { device: body.device },
    });
    return { id: row!.id };
  }

  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.requestDb
      .current()
      .delete(pushSubscription)
      .where(eq(pushSubscription.id, id))
      .returning({ device: pushSubscription.device });
    if (deleted.length === 0) throw new ApiProblem(404, "not_found");
    await this.securityLog.record({
      type: "push.unsubscribed",
      outcome: "success",
      actorUserId: userId,
      metadata: { device: deleted[0]!.device },
    });
  }

  async test(userId: string): Promise<void> {
    if (!this.push) throw new ApiProblem(503, "push_unavailable");
    const limit = await this.rateLimit.consume(`push-test:user:${userId}`, TESTS_PER_HOUR, 3600);
    if (!limit.allowed) {
      throw new ApiProblem(429, "rate_limited", undefined, {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    const job: NotificationPushJob = { userId, kind: "test" };
    await this.jobs.send(JOB_QUEUES.notificationPush, job, { retryLimit: 2, expireInSeconds: 300 });
  }
}
