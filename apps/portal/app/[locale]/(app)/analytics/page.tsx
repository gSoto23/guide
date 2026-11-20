import { setRequestLocale } from "next-intl/server";
import { AnalyticsView } from "@/components/analytics/analytics-view";

/** Workspace analytics (feature 010 US3; screen H-34). */
export default async function AnalyticsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="page-wide">
      <AnalyticsView locale={locale} />
    </main>
  );
}
