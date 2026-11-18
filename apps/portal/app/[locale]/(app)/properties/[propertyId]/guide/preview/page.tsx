import { setRequestLocale } from "next-intl/server";
import { GuidePreviewView } from "@/components/guide/guide-preview";

/** The guide as guests will see it (feature 003 US3, FR-054). */
export default async function GuidePreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
  searchParams: Promise<{ source?: string; lang?: string }>;
}) {
  const { locale, propertyId } = await params;
  const { source, lang } = await searchParams;
  setRequestLocale(locale);
  const safeSource =
    source === "published" || (source && /^[1-9]\d{0,5}$/.test(source)) ? source : "draft";
  const safeLang = lang === "es" || lang === "en" ? lang : undefined;
  return (
    <main>
      <GuidePreviewView
        locale={locale}
        propertyId={propertyId}
        source={safeSource}
        lang={safeLang}
      />
    </main>
  );
}
