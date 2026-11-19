/**
 * Stage settings for the public pages (feature 014 research R4). Read on the server at request
 * time; the pages render per request already (the locale layout reads the CSP nonce).
 */
export interface PublicSettings {
  /** Where people write about privacy and the terms; null hides the lines that need it. */
  contactEmail: string | null;
  /** Who is responsible; "Guidesk" until the legal entity exists (OQ-01). */
  companyName: string;
  /** The portal's public origin, for canonical URLs, alternates, and the sitemap. */
  portalUrl: string;
}

const DEFAULT_COMPANY = "Guidesk";
const DEFAULT_PORTAL_URL = "http://localhost:3000";

/** A plain shape check without a regular expression (the value comes from deploy settings). */
export function isEmail(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

function origin(value: string | undefined): string {
  if (!value) return DEFAULT_PORTAL_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_PORTAL_URL;
    return url.origin;
  } catch {
    return DEFAULT_PORTAL_URL;
  }
}

export function publicSettings(
  env: Record<string, string | undefined> = process.env,
): PublicSettings {
  const email = env.CONTACT_EMAIL?.trim() ?? "";
  const company = env.COMPANY_NAME?.trim() ?? "";
  return {
    contactEmail: email && isEmail(email) ? email : null,
    companyName: company && company.length <= 120 ? company : DEFAULT_COMPANY,
    portalUrl: origin(env.PORTAL_URL),
  };
}
