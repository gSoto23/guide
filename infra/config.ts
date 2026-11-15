/**
 * Per-stage settings (ADR-0009). Pilot stages stay small; production grows before launch.
 * Domains come from environment variables until the brand domain is chosen (OQ-11).
 */
export const isProduction = $app.stage === "production";

export const stageConfig = {
  /** Single-AZ for the pilot; switch to true before the public launch (ADR-0009). */
  databaseMultiAz: false,
  databaseInstance: isProduction ? "t4g.small" : "t4g.micro",
  /** Fargate tasks: small Graviton tasks; scale out under load. */
  apiScaling: { min: 1, max: isProduction ? 4 : 1 },
  /** Custom domains (optional outside production). */
  portalDomain: process.env.GUIDESK_PORTAL_DOMAIN,
  apiDomain: process.env.GUIDESK_API_DOMAIN,
  emailSender: process.env.GUIDESK_EMAIL_SENDER,
};

if (isProduction && (!stageConfig.portalDomain || !stageConfig.apiDomain)) {
  // Production must use HTTPS end to end, which needs domains and certificates (SEC-11).
  throw new Error("GUIDESK_PORTAL_DOMAIN and GUIDESK_API_DOMAIN are required for production");
}
