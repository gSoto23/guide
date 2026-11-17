import { describeError } from "@guidesk/observability";
import { Injectable, Logger } from "@nestjs/common";
import type { EmailMessage } from "@guidesk/integrations";
import { JobQueueService } from "../jobs/job-queue.service.js";

export const EMAIL_QUEUE = "email.send";

/**
 * Email outbox (contracts/emails.md: "Sent from Worker"). The API renders the email and queues
 * it in pg-boss; the worker delivers it with retries. One-time codes are not queued: they are
 * sent inline for speed (T040).
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger("Outbox");

  constructor(private readonly jobs: JobQueueService) {}

  /** Queues an email; failures are logged, never thrown into the request that triggered it. */
  async enqueueEmail(message: EmailMessage): Promise<void> {
    try {
      await this.jobs.send(EMAIL_QUEUE, { ...message }, { retryLimit: 5, retryBackoff: true });
    } catch (error) {
      this.logger.error(`Failed to queue email ${message.template}`, describeError(error));
    }
  }
}
