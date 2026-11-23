import type { ReactNode } from "react";
import Link from "next/link";
import { chevron, globe, Icon } from "@guidesk/ui";
import { BrandLogo } from "@/components/brand-logo";
import type { PublicCatalog } from "@/lib/public/catalog";
import { otherLocale, type PublicPage } from "@/lib/public/routes";
import type { PublicSettings } from "@/lib/public/settings";
import { fill } from "@/lib/public/text";

/**
 * Header and footer of the public pages (feature 014 FR-001, FR-004). Server component: plain
 * links only, so the pages ship no JavaScript of their own.
 */
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
          <Link href={`/${locale}`} className="public-brand">
            <BrandLogo alt={catalog.nav.home} height={30} />
          </Link>
          <nav className="public-nav" aria-label="Guidesk">
            {/* Feature 017: a compact language pill (both codes, the current one marked) and pill
                buttons. Each code keeps its full name for screen readers (WCAG 2.5.3, 3.1.2). */}
            <div className="lang-switch" role="group" aria-label={catalog.nav.languageGroup}>
              <Icon data={globe} size={16} className="lang-switch-icon" />
              <span className="lang-option lang-current" aria-current="true" lang={locale}>
                {locale.toUpperCase()}
                <span className="visually-hidden"> · {catalog.nav.languageCurrent}</span>
              </span>
              <Link href={`/${other}${page}`} hrefLang={other} lang={other} className="lang-option">
                {other.toUpperCase()}
                <span className="visually-hidden"> · {catalog.nav.language}</span>
              </Link>
            </div>
            <Link href={`/${locale}/sign-in`} className="button public-signin">
              {catalog.nav.signIn}
              <Icon data={chevron} size={16} />
            </Link>
            <Link href={`/${locale}/sign-in`} className="button button-primary public-start">
              {catalog.nav.start}
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
