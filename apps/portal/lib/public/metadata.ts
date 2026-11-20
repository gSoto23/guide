import type { Metadata } from "next";
import { publicCatalog } from "./catalog";
import { alternates, type PublicPage } from "./routes";
import { publicSettings } from "./settings";

const KEYS = { "": "home", "/privacy": "privacy", "/terms": "terms" } as const;

/** Title, description, alternates, and indexing for a public page (feature 014 FR-011). */
export function publicMetadata(locale: string, page: PublicPage): Metadata {
  const settings = publicSettings();
  const meta = publicCatalog(locale).meta[KEYS[page]];
  const languages = alternates(settings.portalUrl, page);
  const canonical = languages[locale === "en" ? "en" : "es"];
  // Feature 015 FR-024, FR-025: the branded preview image, served from the portal.
  const image = {
    url: `${settings.portalUrl}/brand/og-${locale === "en" ? "en" : "es"}.png`,
    width: 1200,
    height: 630,
    alt: "Guidesk",
  };
  return {
    title: meta.title,
    description: meta.description,
    metadataBase: new URL(settings.portalUrl),
    alternates: { canonical, languages },
    robots: { index: true, follow: true },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: canonical,
      siteName: "Guidesk",
      locale: locale === "en" ? "en_US" : "es_CR",
      type: "website",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: [image.url],
    },
  };
}
