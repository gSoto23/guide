"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMeContext } from "@/lib/me-context";
import { WorkspaceSwitcher } from "./workspace-switcher";

/** Header of every signed-in screen: the current workspace and the main sections (FR-022). */
export function AppHeader({ locale }: { locale: string }) {
  const t = useTranslations("workspace");
  const context = useMeContext();
  const me = context?.me;
  // Someone removed from their last workspace still sees the switcher, to create one (spec edge case).
  if (!context || !me) return null;
  return (
    <header className="app-header">
      <WorkspaceSwitcher me={me} onChanged={context.refresh} />
      <nav aria-label="Guidesk">
        <Link href={`/${locale}/inbox`}>{t("nav.inbox")}</Link>
        <Link href={`/${locale}/requests`}>{t("nav.requests")}</Link>
        <Link href={`/${locale}/analytics`}>{t("nav.analytics")}</Link>
        <Link href={`/${locale}/properties`}>{t("nav.properties")}</Link>
        <Link href={`/${locale}/shared-content`}>{t("nav.shared")}</Link>
        <Link href={`/${locale}/settings/members`}>{t("nav.team")}</Link>
        <Link href={`/${locale}/settings`}>{t("nav.settings")}</Link>
      </nav>
    </header>
  );
}
