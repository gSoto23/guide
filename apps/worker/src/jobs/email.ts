import type { EmailAdapter, EmailMessage } from "@guidesk/integrations";

/** Queue filled by the API outbox (apps/api/src/notifications/outbox.service.ts). */
export const EMAIL_QUEUE = "email.send";

function isEmailMessage(value: unknown): value is EmailMessage {
  const m = value as Partial<EmailMessage> | null;
  return Boolean(
    m &&
    typeof m.to === "string" &&
    typeof m.subject === "string" &&
    typeof m.html === "string" &&
    typeof m.text === "string" &&
    typeof m.template === "string",
  );
}

/**
 * Delivers queued transactional emails (contracts/emails.md, T064). Throwing makes pg-boss retry
 * with backoff; malformed jobs fail permanently instead of retrying forever.
 */
export function createEmailHandler(adapter: EmailAdapter) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      if (!isEmailMessage(job.data)) {
        console.error(`email job ${job.id} has an invalid payload; dropping it`);
        continue;
      }
      await adapter.send(job.data);
    }
  };
}
