import { setRequestLocale } from "next-intl/server";
import { Interview } from "@/components/guide/interview";

const SECTION_KINDS = new Set([
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
]);

/** The AI interview (screen H-14, feature 003 US4). */
export default async function InterviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const { locale, propertyId } = await params;
  const { section } = await searchParams;
  setRequestLocale(locale);
  return (
    <main>
      <Interview
        locale={locale}
        propertyId={propertyId}
        sectionKind={section && SECTION_KINDS.has(section) ? section : undefined}
      />
    </main>
  );
}
