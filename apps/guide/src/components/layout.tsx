import type { ReactNode } from "react";
import type { Assets } from "../assets.js";
import type { GuestLocale, Translate } from "../i18n.js";

export interface PageChrome {
  t: Translate;
  locale: GuestLocale;
  assets: Assets;
}

interface LayoutProps extends PageChrome {
  title: string;
  /** Guide pages: the public ID, links, and the client texts. */
  guide?: {
    publicId: string;
    propertyName: string;
    homeHref: string;
    emergencyHref: string;
    switchHref: string | null;
    switchLocale: GuestLocale | null;
  };
  /** Strings the browser script needs, as a JSON data block (never executed; CSP-safe). */
  clientTexts?: Record<string, string>;
  children: ReactNode;
}

/** JSON for a data block: `<` escaped so the block can never close early. */
function jsonBlock(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** The document shell: no inline script or style, never indexed, no referrer (R15). */
export function Layout({ t, locale, assets, title, guide, clientTexts, children }: LayoutProps) {
  return (
    <html lang={locale} data-public-id={guide?.publicId} data-offline-at="">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
        <meta name="theme-color" content="#FFFCF8" />
        <title>{title}</title>
        <link rel="stylesheet" href={assets.style} />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <script src={assets.script} defer />
      </head>
      <body>
        <a className="skip" href="#main">
          {t("nav.home")}
        </a>
        {guide ? (
          <header className="top">
            <a className="top-name" href={guide.homeHref}>
              {guide.propertyName}
            </a>
            <nav className="top-actions" aria-label={t("nav.language")}>
              {guide.switchHref && guide.switchLocale ? (
                <a
                  className="top-link"
                  href={guide.switchHref}
                  hrefLang={guide.switchLocale}
                  lang={guide.switchLocale}
                  data-switch-locale={guide.switchLocale}
                >
                  {t("nav.switchTo")}
                </a>
              ) : null}
              <a className="top-emergency" href={guide.emergencyHref}>
                {t("nav.emergency")}
              </a>
            </nav>
          </header>
        ) : null}
        <div id="offline-banner" className="banner" role="status" hidden />
        <div id="notice" className="banner banner-notice" role="status" hidden />
        <main id="main" className="main">
          {children}
        </main>
        {guide ? (
          // Hidden until the page script runs: without scripts there is no chat (edge cases).
          <button
            type="button"
            id="ask"
            className="ask"
            hidden
            data-chat-script={assets.chatScript}
            data-chat-style={assets.chatStyle}
          >
            {t("chat.ask")}
          </button>
        ) : null}
        {clientTexts ? (
          <script
            type="application/json"
            id="guest-texts"
            dangerouslySetInnerHTML={{ __html: jsonBlock(clientTexts) }}
          />
        ) : null}
      </body>
    </html>
  );
}
