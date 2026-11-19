import type { ReactNode } from "react";
import Link from "next/link";
import type { PublicCatalog } from "@/lib/public/catalog";
import { otherLocale, type PublicPage } from "@/lib/public/routes";
import type { PublicSettings } from "@/lib/public/settings";
import { fill } from "@/lib/public/text";

/**
 * Header and footer of the public pages (feature 014 FR-001, FR-004). Server component: plain
 * links only, so the pages ship no JavaScript of their own.
 */
export function BrandMark() {
  return (
    <svg className="public-mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path fill="#B4452A" d="M1 14V5a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4Z" />
      <path fill="#F5BC4C" d="M6 14V8a2 2 0 0 1 4 0v6Z" />
    </svg>
  );
}

export function PublicShell({
  locale,
  page,
  catalog,
  settings,
  children,
}: {
  locale: string;
  page: PublicPage;
  catalog: PublicCatalog;
  settings: PublicSettings;
  children: ReactNode;
}) {
  const other = otherLocale(locale);
  const year = String(new Date().getUTCFullYear());
  return (
    <div className="public-page">
      <a className="public-skip" href="#content">
        {catalog.nav.skip}
      </a>
      <header className="public-header">
        <div className="public-container public-header-row">
          <Link href={`/${locale}`} className="public-brand" aria-label={catalog.nav.home}>
            <BrandMark />
            <span aria-hidden="true">Guidesk</span>
          </Link>
          <nav className="public-nav" aria-label="Guidesk">
            {/* The visible name is the accessible name (WCAG 2.5.3); lang lets readers say it right. */}
            <Link href={`/${other}${page}`} hrefLang={other} lang={other}>
              {catalog.nav.language}
            </Link>
            <Link href={`/${locale}/sign-in`} className="button button-secondary">
              {catalog.nav.signIn}
            </Link>
          </nav>
        </div>
      </header>
      <main id="content" className="public-main">
        {children}
      </main>
      <footer className="public-footer">
        <div className="public-container public-footer-row">
          <nav aria-label={`${catalog.footer.privacy} · ${catalog.footer.terms}`}>
            <ul className="public-footer-links">
              <li>
                <Link href={`/${locale}/privacy`}>{catalog.footer.privacy}</Link>
              </li>
              <li>
                <Link href={`/${locale}/terms`}>{catalog.footer.terms}</Link>
              </li>
            </ul>
          </nav>
          {settings.contactEmail ? (
            <p>{fill(catalog.footer.contact, { email: settings.contactEmail })}</p>
          ) : null}
          <p>{fill(catalog.footer.rights, { year, company: settings.companyName })}</p>
        </div>
      </footer>
    </div>
  );
}
