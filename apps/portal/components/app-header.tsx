"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { useMeContext } from "@/lib/me-context";
import { BrandLogo } from "./brand-logo";
import { DESTINATIONS, type DestinationId } from "./shell/destinations";
import { MoreButton, NavLink } from "./shell/nav-link";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { Avatar } from "./avatar";
import { EmailText } from "./email-text";

export type ShellIcons = Record<DestinationId | "more", ReactNode>;

/**
 * The signed-in shell's navigation (FR-022; feature 015 contract portal-shell): a top bar and a
 * bottom bar on phones and tablets, a sidebar from 1024 px. The icons are rendered by the server
 * layout and passed in, so they add nothing to the page's JavaScript (research R3).
 */
export function AppHeader({ locale, icons }: { locale: string; icons: ShellIcons }) {
  const t = useTranslations("workspace");
  const context = useMeContext();
  const me = context?.me;
  // Someone removed from their last workspace still sees the switcher, to create one (spec edge case).
  // Before the account loads, the logo and navigation show at once with a placeholder where the
  // switcher and the account go, so a reload never shows a blank page (feature 017 FR-020).
  if (!context) return null;
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
            <BrandLogo alt={t("nav.home")} height={26} />
          </Link>
          {me ? (
            <WorkspaceSwitcher me={me} onChanged={context.refresh} />
          ) : (
            <div className="shell-placeholder" aria-hidden="true" />
          )}
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
          {me ? (
            <Link href={href("/settings/account")} className="side-account">
              <Avatar name={me.user.name} email={me.user.email} />
              <span>
                <span className="side-account-name">
                  {me.user.name || <EmailText email={me.user.email} />}
                </span>
                <span className="side-account-hint">{t("nav.account")}</span>
              </span>
            </Link>
          ) : null}
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
