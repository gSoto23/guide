import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { doorScene, Illustration } from "@guidesk/ui";
import { BrandLogo } from "@/components/brand-logo";

/**
 * Sign-in, verify, and invitation share a brand layout (feature 015 US4, contract portal-shell):
 * the logo and a small illustration above the form on phones; on wide screens, the form next to a
 * brand panel with the illustration and the tagline.
 */
export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  const nav = await getTranslations({ locale, namespace: "workspace.nav" });
  return (
    <div className="auth-shell">
      <div className="auth-panel">
        <header className="auth-header">
          <Link href={`/${locale}`} className="auth-brand">
            <BrandLogo alt={nav("home")} height={32} />
          </Link>
        </header>
        <Illustration data={doorScene} width={160} className="auth-illustration" />
        {children}
      </div>
      <aside className="auth-brand-panel" aria-label="Guidesk">
        <Illustration data={doorScene} width={360} />
        <p className="auth-tagline">{t("tagline")}</p>
      </aside>
    </div>
  );
}
