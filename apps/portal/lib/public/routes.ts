import { LOCALES } from "@guidesk/i18n";

/**
 * The public pages (feature 014, contracts/public-pages.md): the only paths search engines may
 * index. Everything else on the portal domain is disallowed and marked noindex.
 */
export const PUBLIC_PAGES = ["", "/privacy", "/terms"] as const;
export type PublicPage = (typeof PUBLIC_PAGES)[number];

export function otherLocale(locale: string): "es" | "en" {
  return locale === "en" ? "es" : "en";
}

/** Absolute URLs of a public page in each language. */
export function alternates(portalUrl: string, page: PublicPage): Record<"es" | "en", string> {
  return Object.fromEntries(
    LOCALES.map((locale) => [locale, `${portalUrl}/${locale}${page}`]),
  ) as Record<"es" | "en", string>;
}

/** Every public URL, for the sitemap. */
export function publicUrls(portalUrl: string): { page: PublicPage; locale: string; url: string }[] {
  return PUBLIC_PAGES.flatMap((page) =>
    LOCALES.map((locale) => ({ page, locale, url: `${portalUrl}/${locale}${page}` })),
  );
}

/** Robots rules: allow the public paths only. `$` keeps `/es` from allowing every `/es/...`. */
export function robotsAllow(): string[] {
  return PUBLIC_PAGES.flatMap((page) =>
    LOCALES.map((locale) => (page === "" ? `/${locale}$` : `/${locale}${page}`)),
  );
}
