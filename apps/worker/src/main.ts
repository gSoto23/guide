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
import { createPmsListingsHandler, createPmsRevokeHandler } from "./jobs/pms-calls.js";
import { createCsvImportHandler, createCsvValidateHandler } from "./jobs/csv.js";
import { createPropertiesPurgeHandler, PURGE_PROPERTIES_CRON } from "./jobs/purge-properties.js";
import { createRetentionHandler, RETENTION_CRON } from "./jobs/retention.js";
import { createPmsImportHandler } from "./jobs/pms-import.js";
import {
  createPmsRefreshHandler,
  createPmsScheduler,
  PMS_SCHEDULE_CRON,
  PMS_SCHEDULE_QUEUE,
} from "./jobs/pms-refresh.js";
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
import { createGuideDraftHandler } from "./jobs/guide-draft.js";
import {
  createGuideTranslateHandler,
  findTranslationWork,
  GUIDE_TRANSLATE_SWEEP_CRON,
  GUIDE_TRANSLATE_SWEEP_QUEUE,
} from "./jobs/guide-translate.js";
import { createGuideDocumentHandler } from "./jobs/guide-document.js";
import { createInterviewAnswerHandler } from "./jobs/interview-answer.js";
import { createSharedBlockPublishHandler } from "./jobs/shared-block-publish.js";
import { createMediaProcessHandler } from "./jobs/media-process.js";
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
  // Feature 003 (research R15).
  await createQueue(JOB_QUEUES.guideDraft);
  await boss.work(
    JOB_QUEUES.guideDraft,
    { localConcurrency: 4 },
    createGuideDraftHandler({ db: services.db.db, llm: services.llm }),
  );
  await createQueue(JOB_QUEUES.mediaProcess);
  await boss.work(
    JOB_QUEUES.mediaProcess,
    { localConcurrency: 2 },
    createMediaProcessHandler({
      db: services.db.db,
      sandbox: services.sandbox,
      storage: services.storage,
      media: services.media,
      requireScan: services.mediaRequireScan,
    }),
  );
  await createQueue(JOB_QUEUES.interviewAnswer);
  await boss.work(
    JOB_QUEUES.interviewAnswer,
    { localConcurrency: 4 },
    createInterviewAnswerHandler({
      db: services.db.db,
      llm: services.llm,
      speech: services.speech,
      sandbox: services.sandbox,
      storage: services.storage,
    }),
  );
  await createQueue(JOB_QUEUES.guideDocument);
  await boss.work(
    JOB_QUEUES.guideDocument,
    { localConcurrency: 2 },
    createGuideDocumentHandler({
      db: services.db.db,
      sandbox: services.sandbox,
      storage: services.storage,
      llm: services.llm,
      requireScan: services.mediaRequireScan,
    }),
  );
  // Shared-block fan-out (research R14): one job per publish or delete.
  await createQueue(JOB_QUEUES.sharedBlockPublish);
  await boss.work(
    JOB_QUEUES.sharedBlockPublish,
    { localConcurrency: 2 },
    createSharedBlockPublishHandler({ db: services.db.db }),
  );
  // Translation per section and language (research R7): saves schedule their own debounced job;
  // the sweep picks up texts nothing scheduled, such as drafts from the worker and restores.
  await createQueue(JOB_QUEUES.guideTranslate);
  await boss.work(
    JOB_QUEUES.guideTranslate,
    { localConcurrency: 4 },
    createGuideTranslateHandler({ db: services.db.db, llm: services.llm }),
  );
  await createQueue(GUIDE_TRANSLATE_SWEEP_QUEUE);
  await boss.work(GUIDE_TRANSLATE_SWEEP_QUEUE, async () => {
    for (const work of await findTranslationWork(services.db.db)) {
      await boss.send(JOB_QUEUES.guideTranslate, work, {
        singletonKey: `${work.sectionId}:${work.language}`,
        retryLimit: 3,
        retryBackoff: true,
      });
    }
  });
  await boss.schedule(GUIDE_TRANSLATE_SWEEP_QUEUE, GUIDE_TRANSLATE_SWEEP_CRON, null, { tz: "UTC" });
  const scheduleCalendars = createCalendarScheduler({
    db: services.db.db,
    send: (queue, data, options) => boss.send(queue, data, options),
  });
  await createQueue(CALENDAR_SCHEDULE_QUEUE);
  await boss.work(CALENDAR_SCHEDULE_QUEUE, async () => {
    await scheduleCalendars();
  });
  await boss.schedule(CALENDAR_SCHEDULE_QUEUE, CALENDAR_SCHEDULE_CRON, null, { tz: "UTC" });

  // PMS imports, refreshes, and the API's calls (US4, research R7).
  const pmsDeps = {
    db: services.db.db,
    decrypter: services.decrypter,
    adapters: services.pms,
  };
  await createQueue(JOB_QUEUES.pmsImport);
  await boss.work(
    JOB_QUEUES.pmsImport,
    createPmsImportHandler({
      ...pmsDeps,
      vault: services.vault,
      queueEmail: services.queueEmail,
      portalUrl: services.portalUrl,
    }),
  );
  await createQueue(JOB_QUEUES.pmsRefresh);
  await boss.work(
    JOB_QUEUES.pmsRefresh,
    createPmsRefreshHandler({
      ...pmsDeps,
      queueEmail: services.queueEmail,
      portalUrl: services.portalUrl,
    }),
  );
  await createQueue(JOB_QUEUES.pmsListings);
  await boss.work(JOB_QUEUES.pmsListings, createPmsListingsHandler(pmsDeps));
  await createQueue(JOB_QUEUES.pmsRevoke);
  await boss.work(JOB_QUEUES.pmsRevoke, createPmsRevokeHandler(pmsDeps));
  const schedulePms = createPmsScheduler({
    db: services.db.db,
    send: (queue, data, options) => boss.send(queue, data, options),
  });
  await createQueue(PMS_SCHEDULE_QUEUE);
  await boss.work(PMS_SCHEDULE_QUEUE, async () => {
    await schedulePms();
  });
  await boss.schedule(PMS_SCHEDULE_QUEUE, PMS_SCHEDULE_CRON, null, { tz: "UTC" });

  // CSV validation and import (US5, research R10).
  const csvDeps = {
    db: services.db.db,
    sandbox: services.sandbox,
    vault: services.vault,
    decrypter: services.decrypter,
    fingerprint: services.feedFingerprint,
    queueEmail: services.queueEmail,
    portalUrl: services.portalUrl,
  };
  await createQueue(JOB_QUEUES.csvValidate);
  await boss.work(JOB_QUEUES.csvValidate, createCsvValidateHandler(csvDeps));
  await createQueue(JOB_QUEUES.csvImport);
  await boss.work(JOB_QUEUES.csvImport, createCsvImportHandler(csvDeps));

  // Removed properties are deleted 30 days after removal (US6, FR-045).
  await createQueue(JOB_QUEUES.propertiesPurge);
  await boss.work(JOB_QUEUES.propertiesPurge, createPropertiesPurgeHandler({ db: services.db.db }));
  await boss.schedule(JOB_QUEUES.propertiesPurge, PURGE_PROPERTIES_CRON, null, { tz: "UTC" });

  // Retention of extraction input, guest names, uploads, and CSV rows (data model §6).
  await createQueue(JOB_QUEUES.retentionDaily);
  await boss.work(
    JOB_QUEUES.retentionDaily,
    createRetentionHandler({ db: services.db.db, storage: services.storage }),
  );
  await boss.schedule(JOB_QUEUES.retentionDaily, RETENTION_CRON, null, { tz: "UTC" });
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
