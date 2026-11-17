/**
 * The sandbox for untrusted content (feature 002, research R2, SEC-09, SEC-10): two Lambda
 * functions that are not attached to the VPC. They reach the internet but have no route to the
 * database, the API, or the worker. The API and worker invoke them synchronously.
 */
import { stageConfig } from "./config";
import { uploads } from "./storage";

const environment: Record<string, string> = {
  NODE_ENV: "production",
  ...(stageConfig.sentryDsn ? { SENTRY_DSN: stageConfig.sentryDsn } : {}),
};

/** Reads one iCal link. Its role has no permissions beyond writing its own logs. */
export const feedReader = new sst.aws.Function("FeedReader", {
  handler: "apps/sandbox/src/feed-reader/handler.handler",
  runtime: "nodejs24.x",
  architecture: "arm64",
  memory: "256 MB",
  // The read itself stops at 10 seconds (research R2).
  timeout: "15 seconds",
  environment,
  permissions: [],
});

const tesseractData = "apps/sandbox/node_modules/@tesseract.js-data";

/**
 * Checks, re-encodes, and recognizes one uploaded image, or parses one CSV file. It can only read
 * and delete objects under `uploads/` in the uploads bucket.
 */
export const fileProcessor = new sst.aws.Function("FileProcessor", {
  handler: "apps/sandbox/src/file-processor/handler.handler",
  runtime: "nodejs24.x",
  architecture: "arm64",
  memory: "2048 MB",
  // One screenshot per invocation; the extraction job's limit is 60 seconds (FR-016).
  timeout: "60 seconds",
  environment: {
    ...environment,
    UPLOADS_BUCKET: uploads.name,
    TESSERACT_LANG_PATH: "lang",
  },
  permissions: [
    {
      actions: ["s3:GetObject", "s3:DeleteObject"],
      resources: [$interpolate`${uploads.arn}/uploads/*`],
    },
  ],
  nodejs: {
    // Native and WebAssembly packages are installed for the Lambda platform, not bundled.
    install: ["sharp", "tesseract.js"],
  },
  // The Spanish and English recognition models ship with the function, so nothing is
  // downloaded at runtime (research R3).
  copyFiles: [
    {
      from: `${tesseractData}/eng/4.0.0_best_int/eng.traineddata.gz`,
      to: "lang/eng.traineddata.gz",
    },
    {
      from: `${tesseractData}/spa/4.0.0_best_int/spa.traineddata.gz`,
      to: "lang/spa.traineddata.gz",
    },
  ],
});
