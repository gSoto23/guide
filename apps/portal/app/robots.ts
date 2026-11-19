import type { MetadataRoute } from "next";
import { robotsAllow } from "../lib/public/routes";
import { publicSettings } from "../lib/public/settings";

// Read PORTAL_URL at request time: in AWS it is a runtime setting, not a build-time one.
export const dynamic = "force-dynamic";

/** Only the public pages may be crawled (feature 014 FR-012, AC-SEC-005). */
export default function robots(): MetadataRoute.Robots {
  const { portalUrl } = publicSettings();
  return {
    rules: { userAgent: "*", allow: robotsAllow(), disallow: "/" },
    sitemap: `${portalUrl}/sitemap.xml`,
  };
}
