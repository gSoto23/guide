import { describeError } from "@guidesk/observability";
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { PgBoss } from "pg-boss";
import type { EmailMessage } from "@guidesk/integrations";
import { API_CONFIG, type ApiConfig } from "../config/config.js";

export const EMAIL_QUEUE = "email.send";

/**
 * Email outbox (contracts/emails.md: "Sent from Worker"). The API renders the email and queues
 * it in pg-boss; the worker delivers it with retries. One-time codes are not queued: they are
 * sent inline for speed (T040).
 */
@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Outbox");
  private boss: PgBoss | undefined;

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  async onModuleInit(): Promise<void> {
    this.boss = new PgBoss(this.config.DATABASE_URL);
    this.boss.on("error", (error: unknown) =>
      this.logger.error("pg-boss error", describeError(error)),
    );
    await this.boss.start();
    await this.boss.createQueue(EMAIL_QUEUE);
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: false });
  }

  /** Queues an email; failures are logged, never thrown into the request that triggered it. */
  async enqueueEmail(message: EmailMessage): Promise<void> {
    try {
      if (!this.boss) throw new Error("outbox not started");
      await this.boss.send(EMAIL_QUEUE, { ...message }, { retryLimit: 5, retryBackoff: true });
    } catch (error) {
      this.logger.error(`Failed to queue email ${message.template}`, describeError(error));
    }
  }
}
