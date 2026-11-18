import { setRequestLocale } from "next-intl/server";
import { GuideVersions } from "@/components/guide/guide-versions";

/** Published versions (feature 003 US3, FR-055). */
export default async function GuideVersionsPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <GuideVersions locale={locale} propertyId={propertyId} />
    </main>
  );
}
