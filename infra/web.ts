/**
 * CloudFront in front of the portal, with AWS WAF (ADR-0009, SEC-07, SEC-11).
 * `/api/*` goes to the API load balancer so the browser sees a single origin and cookies stay
 * host-only on the portal domain.
 */
import { stageConfig } from "./config";
import { portalUrl, router } from "./router";
import { api } from "./services";
import { media, uploads } from "./storage";

export { router };

router.route("/api", api.url);

export const portal = new sst.aws.Nextjs("Portal", {
  path: "apps/portal",
  router: { instance: router },
  server: {
    architecture: "arm64",
  },
  // Feature 014 (research R4): the public pages' origin, contact address, and company name.
  environment: {
    PORTAL_URL: portalUrl,
    // Feature 016: signed photo URLs load from the media bucket (portal CSP img-src).
    MEDIA_ORIGIN: $interpolate`https://${media.domain}`,
    // Feature 020 (G-01): browsers post files straight to the uploads bucket (portal CSP
    // connect-src); both the global and the regional host, since the SDK may sign either.
    UPLOAD_ORIGINS: $interpolate`https://${uploads.domain} https://${uploads.name}.s3.us-east-1.amazonaws.com`,
    ...(stageConfig.contactEmail ? { CONTACT_EMAIL: stageConfig.contactEmail } : {}),
    ...(stageConfig.companyName ? { COMPANY_NAME: stageConfig.companyName } : {}),
  },
});
