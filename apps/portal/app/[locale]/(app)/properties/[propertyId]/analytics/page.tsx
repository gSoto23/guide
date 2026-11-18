import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AnalyticsView } from "@/components/analytics/analytics-view";

/** A property's analytics (feature 010 US1, US2, US4; screen H-34). */
export default async function PropertyAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("analytics");
  return (
    <main>
      <p>
        <Link href={`/${locale}/properties/${propertyId}`}>{t("backToProperty")}</Link>
      </p>
      <AnalyticsView locale={locale} propertyId={propertyId} />
    </main>
  );
}
