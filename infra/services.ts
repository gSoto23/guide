/**
 * ECS Fargate services for the NestJS API and the pg-boss worker (ADR-0009).
 * Graviton (arm64) tasks; the API sits behind an Application Load Balancer.
 */
import { stageConfig } from "./config";
import { database } from "./database";
import { email } from "./email";
import { restrictedDataKey, restrictedDataKeyPolicy } from "./keys";
import { vpc } from "./network";
import { guideUrl, portalUrl } from "./router";
import { apiSecretArns, workerSecretArns } from "./runtime-secrets";
import { feedReader, fileProcessor } from "./sandbox";
import { media, uploads } from "./storage";

const cluster = new sst.aws.Cluster("Cluster", { vpc });

// Only the email identity is linked (for SES permissions). Secrets arrive through `ssm`
// (Secrets Manager, valueFrom), never as plain environment variables (T103).
const linked = email ? [email] : [];

/** Non-secret connection details; the password comes from Secrets Manager. TLS is required. */
const databaseEnvironment = {
  DATABASE_HOST: database.host,
  DATABASE_PORT: $interpolate`${database.port}`,
  DATABASE_NAME: database.database,
  DATABASE_USER: database.username,
  DATABASE_SSLMODE: "no-verify",
};

const emailEnvironment = {
  EMAIL_TRANSPORT: email ? "ses" : "smtp",
  ...(stageConfig.emailSender ? { EMAIL_FROM: stageConfig.emailSender } : {}),
};

/**
 * Feature 002 adapters (T006, T007): the restricted-data key, the uploads bucket, the sandbox
 * functions, the PMS providers, and the feature flags. Secrets arrive through `ssm`.
 */
const integrationEnvironment = {
  KMS_MODE: "aws",
  KMS_KEY_ID: restrictedDataKey.arn,
  STORAGE_MODE: "s3",
  UPLOADS_BUCKET: uploads.name,
  MEDIA_BUCKET: media.name,
  SANDBOX_MODE: "lambda",
  SANDBOX_FEED_READER_FUNCTION: feedReader.name,
  SANDBOX_FILE_PROCESSOR_FUNCTION: fileProcessor.name,
  PMS_MODE: "live",
  SPEECH_MODE: "transcribe",
  MEDIA_REQUIRE_SCAN: "true",
  // Feature 009: live partner data; the Civitatis number appears in every Civitatis link.
  EXPERIENCES_MODE: "live",
  ...(stageConfig.civitatisAffiliateId
    ? { CIVITATIS_AFFILIATE_ID: stageConfig.civitatisAffiliateId }
    : {}),
  ...stageConfig.flags,
};

const observabilityEnvironment: Record<string, string> = stageConfig.sentryDsn
  ? { SENTRY_DSN: stageConfig.sentryDsn }
  : {};

/** Data keys only, and only with a workspace_id encryption context (research R5). */
const dataKeyPermission = {
  actions: ["kms:GenerateDataKey", "kms:Decrypt"],
  resources: [restrictedDataKey.arn],
  conditions: [
    {
      test: "ForAnyValue:StringEquals",
      variable: "kms:EncryptionContextKeys",
      values: ["workspace_id"],
    },
  ],
};

const apiListener = stageConfig.apiDomain
  ? { listen: "443/https" as const, forward: "4000/http" as const }
  : { listen: "80/http" as const, forward: "4000/http" as const };

export const api = new sst.aws.Service("Api", {
  cluster,
  image: { context: ".", dockerfile: "apps/api/Dockerfile" },
  architecture: "arm64",
  cpu: "0.25 vCPU",
  memory: "0.5 GB",
  scaling: stageConfig.apiScaling,
  link: linked,
  environment: {
    NODE_ENV: "production",
    PORT: "4000",
    PORTAL_URL: portalUrl,
    // The only origin allowed on guest routes (feature 004 research R2).
    GUIDE_URL: guideUrl,
    // CloudFront and the load balancer: the only X-Forwarded-For hops the API trusts.
    TRUSTED_PROXY_HOPS: "2",
    // Feature 006: the VAPID contact; the keys come from Secrets Manager.
    VAPID_SUBJECT: portalUrl,
    ...databaseEnvironment,
    ...emailEnvironment,
    ...integrationEnvironment,
    ...observabilityEnvironment,
  },
  ssm: apiSecretArns,
  permissions: [
    dataKeyPermission,
    // The API signs presigned POST forms for uploads (research R9).
    { actions: ["s3:PutObject"], resources: [$interpolate`${uploads.arn}/uploads/*`] },
    // Saving a calendar link reads it through the feed reader first (FR-021).
    { actions: ["lambda:InvokeFunction"], resources: [feedReader.arn] },
    // Presigned GET URLs for guide media shown in the portal (feature 003 research R9).
    { actions: ["s3:GetObject"], resources: [$interpolate`${media.arn}/media/*`] },
  ],
  loadBalancer: {
    ...(stageConfig.apiDomain ? { domain: stageConfig.apiDomain } : {}),
    rules: [apiListener],
    health: {
      "4000/http": { path: "/api/health" },
    },
  },
  dev: {
    command: "pnpm --filter @guidesk/api dev",
  },
});

export const worker = new sst.aws.Service("Worker", {
  cluster,
  image: { context: ".", dockerfile: "apps/worker/Dockerfile" },
  architecture: "arm64",
  cpu: "0.25 vCPU",
  memory: "0.5 GB",
  link: linked,
  environment: {
    NODE_ENV: "production",
    PORTAL_URL: portalUrl,
    // Feature 005: assistant replies may link to the guide's own pages (research R6).
    GUIDE_URL: guideUrl,
    // Feature 006: the VAPID contact; the keys come from Secrets Manager.
    VAPID_SUBJECT: portalUrl,
    ...databaseEnvironment,
    ...emailEnvironment,
    ...integrationEnvironment,
    ...observabilityEnvironment,
    LLM_MODE: "anthropic",
  },
  ssm: workerSecretArns,
  permissions: [
    dataKeyPermission,
    // Retention and rejected uploads (data model §6).
    { actions: ["s3:DeleteObject"], resources: [$interpolate`${uploads.arn}/uploads/*`] },
    { actions: ["lambda:InvokeFunction"], resources: [feedReader.arn, fileProcessor.arn] },
    // Feature 003: the malware scan result on media and documents (research R9), and voice notes
    // sent to Amazon Transcribe with the transcript written back under transcripts/ (research R8).
    // Transcribe reads and writes S3 with the caller's permissions (unverified: research R22 gate).
    {
      actions: ["s3:GetObjectTagging", "s3:GetObject"],
      resources: [$interpolate`${uploads.arn}/uploads/*`],
    },
    {
      actions: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      resources: [$interpolate`${uploads.arn}/transcripts/*`],
    },
    {
      actions: [
        "transcribe:StartTranscriptionJob",
        "transcribe:GetTranscriptionJob",
        "transcribe:DeleteTranscriptionJob",
      ],
      resources: ["*"],
    },
    // Media copies on duplication, size checks, and the media sweep (data model §6).
    {
      actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      resources: [$interpolate`${media.arn}/media/*`],
    },
  ],
  dev: {
    command: "pnpm --filter @guidesk/worker dev",
  },
});

// Only the API and worker task roles may use the restricted-data key (research R5).
new aws.kms.KeyPolicy("RestrictedDataKeyPolicy", {
  keyId: restrictedDataKey.id,
  policy: restrictedDataKeyPolicy([api.nodes.taskRole.arn, worker.nodes.taskRole.arn]),
});
