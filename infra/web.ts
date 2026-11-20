/**
 * CloudFront in front of the portal, with AWS WAF (ADR-0009, SEC-07, SEC-11).
 * `/api/*` goes to the API load balancer so the browser sees a single origin and cookies stay
 * host-only on the portal domain.
 */
import { stageConfig } from "./config";
import { portalUrl, router } from "./router";
import { api } from "./services";
import { media } from "./storage";

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
    ...(stageConfig.contactEmail ? { CONTACT_EMAIL: stageConfig.contactEmail } : {}),
    ...(stageConfig.companyName ? { COMPANY_NAME: stageConfig.companyName } : {}),
  },
});
