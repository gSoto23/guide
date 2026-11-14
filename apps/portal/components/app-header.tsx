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
  if (!context || !me || me.memberships.length === 0) return null;
  return (
    <header className="app-header">
      <WorkspaceSwitcher me={me} onChanged={context.refresh} />
      <nav aria-label="Guidesk">
        <Link href={`/${locale}/properties/new`}>{t("nav.home")}</Link>
        <Link href={`/${locale}/settings/members`}>{t("nav.team")}</Link>
        <Link href={`/${locale}/settings/security`}>{t("nav.security")}</Link>
      </nav>
    </header>
  );
}
