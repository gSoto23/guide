import "./instrument.js";
import { PgBoss } from "pg-boss";
import { SesEmailAdapter, SmtpEmailAdapter, type EmailAdapter } from "@guidesk/integrations";
import { describeError, shutdownObservability } from "@guidesk/observability";
import { loadConfig, type WorkerConfig } from "./config.js";
import { createEmailHandler, EMAIL_QUEUE } from "./jobs/email.js";
import {
  createExpireInvitationsHandler,
  EXPIRE_INVITATIONS_CRON,
  EXPIRE_INVITATIONS_QUEUE,
} from "./jobs/invitations.js";

function emailAdapter(config: WorkerConfig): EmailAdapter {
  return config.email.transport === "ses"
    ? new SesEmailAdapter({
        from: config.email.from,
        configurationSetName: config.email.sesConfigurationSet,
      })
    : new SmtpEmailAdapter({
        host: config.email.smtpHost,
        port: config.email.smtpPort,
        from: config.email.from,
      });
}

/**
 * Background worker (spec 001 plan): transactional emails and daily invitation expiry (T076);
 * purges arrive in later tasks (T094, T095).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const boss = new PgBoss(config.databaseUrl);

  boss.on("error", (error: unknown) => {
    console.error("pg-boss error", describeError(error));
  });

  await boss.start();
  await boss.createQueue(EMAIL_QUEUE);
  await boss.work(EMAIL_QUEUE, createEmailHandler(emailAdapter(config)));
  await boss.createQueue(EXPIRE_INVITATIONS_QUEUE);
  await boss.work(EXPIRE_INVITATIONS_QUEUE, createExpireInvitationsHandler(boss.getDb()));
  await boss.schedule(EXPIRE_INVITATIONS_QUEUE, EXPIRE_INVITATIONS_CRON, null, { tz: "UTC" });
  console.warn("Guidesk worker started");

  const shutdown = async (signal: string): Promise<void> => {
    console.warn(`Received ${signal}, stopping worker`);
    await boss.stop({ graceful: true });
    await shutdownObservability();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(describeError(error));
  process.exit(1);
});
