import { setRequestLocale } from "next-intl/server";
import { AnalyticsCard } from "@/components/analytics/analytics-card";
import { AssistantCard } from "@/components/assistant/assistant-card";
import { ExploreCard } from "@/components/explore/explore-card";
import { ExtrasCard } from "@/components/extras/extras-card";
import { PropertyFacts } from "@/components/properties/property-facts";

/**
 * A property's page: facts, then listing content, calendars, and stays (T046); from 1024 px the
 * cover and the summary cards sit in a side column (feature 017 FR-016).
 */
export default async function PropertyPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  return (
    <main className="page-wide property-page">
      <PropertyFacts
        locale={locale}
        propertyId={propertyId}
        aside={
          <>
            <AnalyticsCard locale={locale} propertyId={propertyId} />
            <AssistantCard locale={locale} propertyId={propertyId} />
            <ExploreCard locale={locale} propertyId={propertyId} />
            <ExtrasCard locale={locale} propertyId={propertyId} />
          </>
        }
      />
    </main>
  );
}
