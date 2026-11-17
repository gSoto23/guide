import "./instrument.js";
import { PgBoss } from "pg-boss";
import { SesEmailAdapter, SmtpEmailAdapter, type EmailAdapter } from "@guidesk/integrations";
import { describeError, shutdownObservability } from "@guidesk/observability";
import { JOB_QUEUES, QUEUE_POLICIES } from "@guidesk/domain";
import { loadConfig, type WorkerConfig } from "./config.js";
import {
  CALENDAR_SCHEDULE_CRON,
  CALENDAR_SCHEDULE_QUEUE,
  createCalendarRefreshHandler,
  createCalendarScheduler,
} from "./jobs/calendar-refresh.js";
import { createEmailHandler, EMAIL_QUEUE } from "./jobs/email.js";
import { createExtractionHandler } from "./jobs/extraction.js";
import {
  createExpireInvitationsHandler,
  EXPIRE_INVITATIONS_CRON,
  EXPIRE_INVITATIONS_QUEUE,
} from "./jobs/invitations.js";
import {
  createPurgeAccountsHandler,
  PURGE_ACCOUNTS_CRON,
  PURGE_ACCOUNTS_QUEUE,
} from "./jobs/purge-accounts.js";
import {
  createPurgeWorkspacesHandler,
  PURGE_WORKSPACES_CRON,
  PURGE_WORKSPACES_QUEUE,
} from "./jobs/purge-workspaces.js";
import { createWorkerServices } from "./services.js";

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
 * Background worker (spec 001 plan): transactional emails, daily invitation expiry (T076), and
 * the workspace and account purges (T094, T095).
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
  await boss.createQueue(PURGE_WORKSPACES_QUEUE);
  await boss.work(PURGE_WORKSPACES_QUEUE, createPurgeWorkspacesHandler(boss.getDb()));
  await boss.schedule(PURGE_WORKSPACES_QUEUE, PURGE_WORKSPACES_CRON, null, { tz: "UTC" });
  await boss.createQueue(PURGE_ACCOUNTS_QUEUE);
  await boss.work(
    PURGE_ACCOUNTS_QUEUE,
    createPurgeAccountsHandler(boss.getDb(), emailAdapter(config)),
  );
  await boss.schedule(PURGE_ACCOUNTS_QUEUE, PURGE_ACCOUNTS_CRON, null, { tz: "UTC" });

  // Feature 002 jobs (research R13).
  const services = createWorkerServices(config, async (message) => {
    await boss.send(EMAIL_QUEUE, { ...message }, { retryLimit: 5, retryBackoff: true });
  });
  const createQueue = (name: string) => {
    const policy = QUEUE_POLICIES[name];
    return boss.createQueue(name, policy ? { policy } : undefined);
  };
  await createQueue(JOB_QUEUES.calendarRefresh);
  await boss.work(
    JOB_QUEUES.calendarRefresh,
    createCalendarRefreshHandler({
      db: services.db.db,
      decrypter: services.decrypter,
      sandbox: services.sandbox,
      queueEmail: services.queueEmail,
      portalUrl: services.portalUrl,
    }),
  );
  await createQueue(JOB_QUEUES.extractionRun);
  await boss.work(
    JOB_QUEUES.extractionRun,
    { localConcurrency: 4 },
    createExtractionHandler({
      db: services.db.db,
      sandbox: services.sandbox,
      llm: services.llm,
    }),
  );
  const scheduleCalendars = createCalendarScheduler({
    db: services.db.db,
    send: (queue, data, options) => boss.send(queue, data, options),
  });
  await createQueue(CALENDAR_SCHEDULE_QUEUE);
  await boss.work(CALENDAR_SCHEDULE_QUEUE, async () => {
    await scheduleCalendars();
  });
  await boss.schedule(CALENDAR_SCHEDULE_QUEUE, CALENDAR_SCHEDULE_CRON, null, { tz: "UTC" });
  console.warn("Guidesk worker started");

  const shutdown = async (signal: string): Promise<void> => {
    console.warn(`Received ${signal}, stopping worker`);
    await boss.stop({ graceful: true });
    await services.close();
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
