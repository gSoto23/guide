import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PropertyExtras } from "@/components/extras/property-extras";

/** A property's extras catalog (feature 008 US1; screen H-27). */
export default async function PropertyExtrasPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("extras");
  return (
    <main>
      <p>
        <Link className="back-link" href={`/${locale}/properties/${propertyId}`}>
          {t("backToProperty")}
        </Link>
      </p>
      <PropertyExtras locale={locale} propertyId={propertyId} />
    </main>
  );
}
