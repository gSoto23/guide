import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PropertyExploreSettings } from "@/components/explore/property-explore";

/** A property's Explore settings and preview (feature 009 US2; screen H-28). */
export default async function PropertyExplorePage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("explore");
  return (
    <main>
      <p>
        <Link href={`/${locale}/properties/${propertyId}`}>{t("backToProperty")}</Link>
      </p>
      <PropertyExploreSettings locale={locale} propertyId={propertyId} />
    </main>
  );
}
