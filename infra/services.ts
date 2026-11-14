/**
 * ECS Fargate services for the NestJS API and the pg-boss worker (ADR-0009).
 * Graviton (arm64) tasks; the API sits behind an Application Load Balancer.
 */
import { stageConfig } from "./config";
import { database } from "./database";
import { email } from "./email";
import { vpc } from "./network";
import { portalUrl } from "./router";
import { apiSecretArns, workerSecretArns } from "./runtime-secrets";

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
    // CloudFront and the load balancer: the only X-Forwarded-For hops the API trusts.
    TRUSTED_PROXY_HOPS: "2",
    ...databaseEnvironment,
    ...emailEnvironment,
  },
  ssm: apiSecretArns,
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
    ...databaseEnvironment,
    ...emailEnvironment,
  },
  ssm: workerSecretArns,
  dev: {
    command: "pnpm --filter @guidesk/worker dev",
  },
});
