import { setRequestLocale } from "next-intl/server";
import { Translations } from "@/components/guide/translations";

/** Translations (screen H-19, feature 003 US5). */
export default async function TranslationsPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <Translations locale={locale} propertyId={propertyId} />
    </main>
  );
}
