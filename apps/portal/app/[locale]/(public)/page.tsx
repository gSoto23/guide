import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { HomeSections } from "@/components/public/home-sections";
import { PublicShell } from "@/components/public/public-shell";
import { publicCatalog } from "@/lib/public/catalog";
import { publicMetadata } from "@/lib/public/metadata";
import { publicSettings } from "@/lib/public/settings";

/** The public home page (feature 014 US1). */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return publicMetadata(locale, "");
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const catalog = publicCatalog(locale);
  return (
    <PublicShell locale={locale} page="" catalog={catalog} settings={publicSettings()}>
      <HomeSections locale={locale} catalog={catalog} />
    </PublicShell>
  );
}
