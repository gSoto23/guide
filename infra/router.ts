/**
 * CloudFront distribution with AWS WAF in front of the portal and the API (ADR-0009, SEC-07,
 * SEC-11). Created before the services so the API knows its public origin (PORTAL_URL); routes
 * are attached in web.ts.
 */
import { stageConfig } from "./config";

export const router = new sst.aws.Router("Router", {
  ...(stageConfig.portalDomain ? { domain: stageConfig.portalDomain } : {}),
  waf: true,
});

/** The portal's public origin: the custom domain, or the CloudFront URL outside production. */
export const portalUrl = stageConfig.portalDomain
  ? `https://${stageConfig.portalDomain}`
  : router.url;
