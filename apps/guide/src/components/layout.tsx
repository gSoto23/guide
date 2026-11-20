import type { ReactNode } from "react";
import { BrandMark, chat, Icon } from "@guidesk/ui";
import type { Assets } from "../assets.js";
import type { GuestLocale, Translate } from "../i18n.js";

export interface PageChrome {
  t: Translate;
  locale: GuestLocale;
  assets: Assets;
  /** Feature 014 FR-010: the privacy policy on the portal, in the page's language. */
  privacyHref?: string;
  /** Feature 015: the portal origin, for the credit link and the link-preview image. */
  portalUrl?: string;
  /** Feature 016: the guide's origin, for an absolute cover preview image. */
  guideUrl?: string;
}

/** Feature 016: the cover as the link-preview image, absolute on the guide's origin. */
export function coverPreview(
  cover: { url: string } | null,
  guideUrl: string | undefined,
): string | null {
  return cover && guideUrl ? `${guideUrl}${cover.url}` : null;
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
    /** Feature 016 FR-006: the cover, as an absolute URL, replaces the branded preview image. */
    previewImage?: string | null;
  };
  /** Strings the browser script needs, as a JSON data block (never executed; CSP-safe). */
  clientTexts?: Record<string, string>;
  /** Feature 015 FR-022: the "Made with Guidesk" credit (Free-plan guides). */
  credit?: boolean;
  /** Feature 015 FR-023: link-preview title; guide pages use the property name. */
  previewTitle?: string;
  /** Feature 015 FR-021: status pages end with the small Guidesk mark. */
  mark?: boolean;
  children: ReactNode;
}

/** JSON for a data block: `<` escaped so the block can never close early. */
function jsonBlock(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** The document shell: no inline script or style, never indexed, no referrer (R15). */
export function Layout({
  t,
  locale,
  assets,
  title,
  guide,
  clientTexts,
  privacyHref,
  portalUrl,
  credit,
  previewTitle,
  mark,
  children,
}: LayoutProps) {
  // Link previews never carry stay data: only the property name and fixed texts (FR-023).
  const preview = previewTitle ?? guide?.propertyName;
  return (
    <html
      lang={locale}
      data-public-id={guide?.publicId}
      data-offline-at=""
      data-privacy-href={privacyHref}
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
        <meta name="theme-color" content="#FFFCF8" />
        <title>{title}</title>
        {preview ? (
          <>
            <meta property="og:type" content="website" />
            <meta property="og:title" content={preview} />
            <meta property="og:description" content={t("meta.preview")} />
            <meta property="og:locale" content={locale === "es" ? "es_CR" : "en_US"} />
            {guide?.previewImage ? (
              <meta property="og:image" content={guide.previewImage} />
            ) : portalUrl ? (
              <>
                <meta property="og:image" content={`${portalUrl}/brand/og-${locale}.png`} />
                <meta property="og:image:width" content="1200" />
                <meta property="og:image:height" content="630" />
              </>
            ) : null}
            <meta name="twitter:card" content="summary_large_image" />
          </>
        ) : null}
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
          {credit && portalUrl ? (
            <p className="credit">
              <a href={`${portalUrl}/${locale}`} target="_blank" rel="noopener">
                <BrandMark size={18} />
                {t("credit")}
              </a>
            </p>
          ) : null}
          {mark ? (
            <p className="status-mark">
              <BrandMark size={18} />
              Guidesk
            </p>
          ) : null}
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
            <Icon data={chat} />
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
