import type { MetadataRoute } from "next";
import { LEGAL_UPDATED } from "../lib/public/legal";
import { alternates, publicUrls } from "../lib/public/routes";
import { publicSettings } from "../lib/public/settings";

// Read PORTAL_URL at request time: in AWS it is a runtime setting, not a build-time one.
export const dynamic = "force-dynamic";

/** The six public URLs with their language alternates (feature 014 FR-012). */
export default function sitemap(): MetadataRoute.Sitemap {
  const { portalUrl } = publicSettings();
  return publicUrls(portalUrl).map(({ page, url }) => ({
    url,
    ...(page === "" ? {} : { lastModified: new Date(`${LEGAL_UPDATED}T00:00:00Z`) }),
    alternates: { languages: alternates(portalUrl, page) },
  }));
}
