/**
 * CloudFront distribution with AWS WAF in front of the portal and the API (ADR-0009, SEC-07,
 * SEC-11). Created before the services so the API knows its public origin (PORTAL_URL); routes
 * are attached in web.ts.
 */
import { stageConfig } from "./config";
import { edgeSharedSecret } from "./secrets";

/**
 * CloudFront adds the edge secret to every API request, and the API refuses production requests
 * without it, so nothing reaches the API around CloudFront and its WAF (research R7, T027). A copy
 * sent by a client is overwritten. The value lives in the CloudFront Function code, which only the
 * stage account's administrators can read.
 */
const edge = {
  viewerRequest: {
    injection: $interpolate`if (event.request.uri.startsWith("/api")) { event.request.headers["x-guidesk-edge"] = { value: ${$util.jsonStringify(edgeSharedSecret.value)} }; }`,
  },
};

export const router = new sst.aws.Router("Router", {
  ...(stageConfig.portalDomain ? { domain: stageConfig.portalDomain } : {}),
  waf: stageConfig.waf,
  edge,
});

/** The portal's public origin: the custom domain, or the CloudFront URL outside production. */
export const portalUrl = stageConfig.portalDomain
  ? `https://${stageConfig.portalDomain}`
  : router.url;

/**
 * The guest guide's own CloudFront distribution with AWS WAF (feature 004 research R2, SEC-11): a
 * separate origin from the portal, so guest cookies stay host-only on the guide domain.
 */
export const guideRouter = new sst.aws.Router("GuideRouter", {
  ...(stageConfig.guideDomain ? { domain: stageConfig.guideDomain } : {}),
  waf: stageConfig.waf,
  edge,
});

/** The guide's public origin: the custom domain, or the CloudFront URL outside production. */
export const guideUrl = stageConfig.guideDomain
  ? `https://${stageConfig.guideDomain}`
  : guideRouter.url;
