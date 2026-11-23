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
  /**
   * Outbound internet for the private subnets (Claude API, Tilopay, PMS APIs). The pilot uses one
   * fck-nat `t4g.nano` instance per AZ (about USD 3 a month each) instead of managed NAT gateways
   * (about USD 33 each); switch to "managed" before the public launch (ADR-0009, 2026-11-23).
   */
  nat: "ec2" as "ec2" | "managed",
  /** AWS WAF on the CloudFront routers: production only during the pilot (about USD 18 a month). */
  waf: isProduction,
  /** Custom domains (optional outside production). */
  portalDomain: process.env.GUIDESK_PORTAL_DOMAIN,
  apiDomain: process.env.GUIDESK_API_DOMAIN,
  /** The guest guide's own origin (feature 004 research R2, SEC-11). */
  guideDomain: process.env.GUIDESK_GUIDE_DOMAIN,
  emailSender: process.env.GUIDESK_EMAIL_SENDER,
  /** Sentry DSN for the services and the sandbox functions (optional). Not a secret. */
  sentryDsn: process.env.GUIDESK_SENTRY_DSN,
  /**
   * Feature 009 (research R12): Guidesk's Civitatis affiliate number (public in every link; empty
   * until the founder joins the program), and the HTTPS origins of partner photos the guide may
   * show, comma-separated (confirm them with the live Viator key; photos from other hosts fall back
   * to the category illustration).
   */
  civitatisAffiliateId: process.env.GUIDESK_CIVITATIS_AFFILIATE_ID ?? "",
  /**
   * Feature 014 (research R4): the public pages' contact address (required in production) and the
   * company named as responsible ("Guidesk" until the legal entity exists, OQ-01).
   */
  contactEmail: process.env.GUIDESK_CONTACT_EMAIL?.trim() ?? "",
  companyName: process.env.GUIDESK_COMPANY_NAME?.trim() ?? "",
  /** Feature 011: where hosts ask for a plan change (shown on Plan and limits); optional. */
  planContactEmail: process.env.GUIDESK_PLAN_CONTACT_EMAIL ?? "",
  experienceImageOrigins: process.env.GUIDESK_EXPERIENCE_IMAGE_ORIGINS ?? "",
  /**
   * Feature flags (feature 002 research R15, feature 003 research R22). Off unless set to "true"
   * for the stage: the PMS flags wait for OQ-26 with each provider, screenshots for the R3
   * accuracy gate, voice answers for the Transcribe and opt-out gates, and scanned PDFs for R22.
   */
  flags: {
    PMS_BEDS24: process.env.GUIDESK_PMS_BEDS24 === "true" ? "true" : "false",
    PMS_HOSTEX: process.env.GUIDESK_PMS_HOSTEX === "true" ? "true" : "false",
    EXTRACTION_SCREENSHOTS:
      process.env.GUIDESK_EXTRACTION_SCREENSHOTS === "true" ? "true" : "false",
    GUIDE_INTERVIEW_VOICE: process.env.GUIDESK_GUIDE_INTERVIEW_VOICE === "true" ? "true" : "false",
    GUIDE_SCANNED_PDF: process.env.GUIDESK_GUIDE_SCANNED_PDF === "true" ? "true" : "false",
  },
};

if (
  isProduction &&
  (!stageConfig.portalDomain || !stageConfig.apiDomain || !stageConfig.guideDomain)
) {
  // Production must use HTTPS end to end, which needs domains and certificates (SEC-11).
  throw new Error(
    "GUIDESK_PORTAL_DOMAIN, GUIDESK_API_DOMAIN, and GUIDESK_GUIDE_DOMAIN are required for production",
  );
}

/** A plain email shape check (no regular expression on deploy input). */
function looksLikeEmail(value: string): boolean {
  const at = value.indexOf("@");
  const domain = value.slice(at + 1);
  return (
    !/\s/.test(value) &&
    at > 0 &&
    at === value.lastIndexOf("@") &&
    domain.lastIndexOf(".") > 0 &&
    domain.lastIndexOf(".") < domain.length - 1
  );
}

if (stageConfig.contactEmail && !looksLikeEmail(stageConfig.contactEmail)) {
  throw new Error("GUIDESK_CONTACT_EMAIL must be an email address");
}

if (isProduction && !stageConfig.contactEmail) {
  // The public privacy policy and terms must say how to reach Guidesk (feature 014 FR-017).
  throw new Error("GUIDESK_CONTACT_EMAIL is required for production");
}
