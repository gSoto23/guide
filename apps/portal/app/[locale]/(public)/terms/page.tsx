import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { LegalDocument } from "@/components/public/legal-document";
import { PublicShell } from "@/components/public/public-shell";
import { publicCatalog } from "@/lib/public/catalog";
import { publicMetadata } from "@/lib/public/metadata";
import { publicSettings } from "@/lib/public/settings";

/** The terms of service (feature 014 US2, FR-007); a draft for the legal review (OQ-35). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return publicMetadata(locale, "/terms");
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const catalog = publicCatalog(locale);
  const settings = publicSettings();
  return (
    <PublicShell locale={locale} page="/terms" catalog={catalog} settings={settings}>
      <LegalDocument
        locale={locale}
        title={catalog.terms.title}
        intro={catalog.terms.intro}
        sections={catalog.terms.sections}
        updatedLabel={catalog.legal.updated}
        tocLabel={catalog.legal.toc}
        values={{ company: settings.companyName, email: settings.contactEmail ?? undefined }}
      />
    </PublicShell>
  );
}
