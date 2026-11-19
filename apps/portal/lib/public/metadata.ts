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
    },
  };
}
