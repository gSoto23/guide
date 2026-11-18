/**
 * The guest guide (feature 004 research R2, R3, ADR-0010): server-rendered pages on a Lambda
 * function behind the guide's own CloudFront distribution. `/api/v1/guest/*` on the same origin
 * goes to the API, so the guest cookie is host-only on the guide domain. Guide pages are cached by
 * CloudFront for 60 seconds following the function's Cache-Control headers.
 */
import { stageConfig } from "./config";
import { guideRouter, guideUrl } from "./router";
import { api } from "./services";
import { media } from "./storage";

guideRouter.route("/api/v1/guest", api.url);

export const guideApp = new sst.aws.Function("GuideApp", {
  handler: "apps/guide/src/lambda.handler",
  runtime: "nodejs24.x",
  architecture: "arm64",
  memory: "512 MB",
  timeout: "10 seconds",
  url: { router: { instance: guideRouter } },
  // Hashed script, styles, icons, and the service worker built by `pnpm --filter @guidesk/guide build`.
  copyFiles: [{ from: "apps/guide/dist/public", to: "public" }],
  environment: {
    NODE_ENV: "production",
    GUIDE_URL: guideUrl,
    // Rendering reads the public guide data through the guide's own origin (cached by CloudFront).
    GUIDE_API_URL: guideUrl,
    GUIDE_PUBLIC_DIR: "public",
    GUIDE_MEDIA_URL: $interpolate`https://${media.domain}`,
    // Feature 009: partner photo hosts the CSP allows (research R9).
    ...(stageConfig.experienceImageOrigins
      ? { EXPERIENCE_IMAGE_ORIGINS: stageConfig.experienceImageOrigins }
      : {}),
    ...(stageConfig.sentryDsn ? { SENTRY_DSN: stageConfig.sentryDsn } : {}),
  },
  permissions: [],
});
