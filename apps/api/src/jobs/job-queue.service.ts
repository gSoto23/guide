import { describeError } from "@guidesk/observability";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { PgBoss } from "pg-boss";
import { QUEUE_POLICIES } from "@guidesk/domain";
import { API_CONFIG, type ApiConfig } from "../config/config.js";

export interface SendOptions {
  retryLimit?: number;
  retryBackoff?: boolean;
  /** Higher runs first, for example "Refresh now" ahead of scheduled refreshes. */
  priority?: number;
  singletonKey?: string;
  expireInSeconds?: number;
  /** Seconds to wait before the job may start, for example until the request has committed. */
  startAfter?: number;
}

/** The parts of pg-boss the queue uses; tests replace it with a fake. */
export interface JobBoss {
  createQueue(name: string, options?: { policy?: string }): Promise<unknown>;
  send(name: string, data: object, options?: SendOptions): Promise<string | null>;
  getJobById(name: string, id: string): Promise<{ state: string; output?: unknown } | null>;
  cancel(name: string, id: string): Promise<unknown>;
}

/** A `call` that did not produce output in time, or whose job failed. Never carries job data. */
export class JobCallError extends Error {
  constructor(
    readonly queue: string,
    readonly reason: "timeout" | "failed" | "not_queued",
  ) {
    super(`Job ${queue} ${reason}`);
    this.name = "JobCallError";
  }
}

/**
 * Sending jobs to the worker, and calling it for an answer (T027, decision 2). The API never
 * decrypts restricted data (research R5): when a route needs a stored credential, for example to
 * list a PMS's listings again or revoke a Beds24 token, it asks the worker and waits.
 */
export class JobQueue {
  private readonly queues = new Set<string>();

  constructor(
    private readonly boss: JobBoss,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async ensureQueue(queue: string): Promise<void> {
    if (this.queues.has(queue)) return;
    const policy = QUEUE_POLICIES[queue];
    await this.boss.createQueue(queue, policy ? { policy } : undefined);
    this.queues.add(queue);
  }

  /** Queues a job. Returns its ID, or null when a singleton job is already queued. */
  async send(queue: string, data: object, options: SendOptions = {}): Promise<string | null> {
    await this.ensureQueue(queue);
    return this.boss.send(queue, data, options);
  }

  /**
   * Queues a job and waits up to `timeoutMs` for its output. The job is not retried; on timeout
   * it is cancelled so a late worker does not act on it.
   */
  async call<T>(queue: string, data: object, timeoutMs: number, pollIntervalMs = 200): Promise<T> {
    const deadline = this.now() + timeoutMs;
    const id = await this.send(queue, data, {
      retryLimit: 0,
      expireInSeconds: Math.max(1, Math.ceil(timeoutMs / 1000)),
    });
    if (!id) throw new JobCallError(queue, "not_queued");
    while (this.now() < deadline) {
      const job = await this.boss.getJobById(queue, id);
      if (job?.state === "completed") return job.output as T;
      if (job?.state === "failed" || job?.state === "cancelled") {
        throw new JobCallError(queue, "failed");
      }
      await this.sleep(Math.min(pollIntervalMs, Math.max(0, deadline - this.now())));
    }
    await this.boss.cancel(queue, id).catch(() => undefined);
    throw new JobCallError(queue, "timeout");
  }
}

/** pg-boss for the API: the email outbox and feature 002 jobs share one client. */
@Injectable()
export class JobQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("JobQueue");
  private boss: PgBoss | undefined;
  private queue: JobQueue | undefined;

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  async onModuleInit(): Promise<void> {
    const boss = new PgBoss(this.config.DATABASE_URL);
    boss.on("error", (error: unknown) => this.logger.error("pg-boss error", describeError(error)));
    await boss.start();
    this.boss = boss;
    this.queue = new JobQueue(boss as unknown as JobBoss);
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: false });
  }

  private started(): JobQueue {
    if (!this.queue) throw new Error("job queue not started");
    return this.queue;
  }

  send(queue: string, data: object, options?: SendOptions): Promise<string | null> {
    return this.started().send(queue, data, options);
  }

  call<T>(queue: string, data: object, timeoutMs: number): Promise<T> {
    return this.started().call<T>(queue, data, timeoutMs);
  }
}
