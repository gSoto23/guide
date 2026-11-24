import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { InlineBrandLogo } from "./brand-logo";
import { DESTINATIONS, type DestinationId } from "./shell/destinations";
import { MoreButton, NavLink } from "./shell/nav-link";
import { ShellAccountLink, ShellSwitcher } from "./shell/shell-account";

export type ShellIcons = Record<DestinationId | "more", ReactNode>;

/**
 * The signed-in shell's navigation (FR-022; feature 015 contract portal-shell): a top bar and a
 * bottom bar on phones and tablets, a sidebar from 1024 px. It renders on the server, so the logo
 * and every destination show before the account loads (feature 017 FR-020) and the lists add no
 * JavaScript; only the current-page marks, the More button, the workspace switcher, and the account
 * link are client islands. The logo is drawn inline, so it needs no request and is not an image
 * candidate for the page's Largest Contentful Paint.
 */
export async function AppHeader({ locale, icons }: { locale: string; icons: ShellIcons }) {
  const t = await getTranslations({ locale, namespace: "workspace" });
  const href = (path: string) => `/${locale}${path}`;
  const work = DESTINATIONS.filter((destination) => destination.group === "work");
  const workspace = DESTINATIONS.filter((destination) => destination.group === "workspace");
  const bar = DESTINATIONS.filter((destination) => destination.inBar);
  const more = DESTINATIONS.filter((destination) => !destination.inBar);
  return (
    <>
      <header className="app-header">
        <div className="app-header-top">
          <Link href={href("/start")} className="app-header-brand">
            <InlineBrandLogo alt={t("nav.home")} height={26} />
          </Link>
          <ShellSwitcher />
        </div>
        <nav aria-label="Guidesk" className="side-nav">
          <ul>
            {work.map((destination) => (
              <li key={destination.id}>
                <NavLink id={destination.id} href={href(destination.path)} className="side-item">
                  {icons[destination.id]}
                  <span>{t(`nav.${destination.label}`)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          <ul className="side-nav-secondary">
            {workspace.map((destination) => (
              <li key={destination.id}>
                <NavLink id={destination.id} href={href(destination.path)} className="side-item">
                  {icons[destination.id]}
                  <span>{t(`nav.${destination.label}`)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          <ShellAccountLink href={href("/settings/account")} hint={t("nav.account")} />
        </nav>
      </header>
      <nav aria-label="Guidesk" className="bottom-bar">
        <ul>
          {bar.map((destination) => (
            <li key={destination.id}>
              <NavLink id={destination.id} href={href(destination.path)} className="bottom-item">
                {icons[destination.id]}
                <span>{t(`nav.${destination.label}`)}</span>
              </NavLink>
            </li>
          ))}
          <li>
            <MoreButton>
              {icons.more}
              <span>{t("nav.more")}</span>
            </MoreButton>
          </li>
        </ul>
        <div id="more-menu" popover="auto" className="more-menu">
          <ul>
            {more.map((destination) => (
              <li key={destination.id}>
                <NavLink id={destination.id} href={href(destination.path)} className="more-item">
                  {icons[destination.id]}
                  <span>{t(`nav.${destination.label}`)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </>
  );
}
