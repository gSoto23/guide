import { setRequestLocale } from "next-intl/server";
import { AssistantCard } from "@/components/assistant/assistant-card";
import { PropertyFacts } from "@/components/properties/property-facts";

/** A property's page: facts, then listing content, calendars, and stays (T046). */
export default async function PropertyPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <PropertyFacts locale={locale} propertyId={propertyId} />
      <AssistantCard locale={locale} propertyId={propertyId} />
    </main>
  );
}
