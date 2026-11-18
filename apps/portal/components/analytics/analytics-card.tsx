import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Analytics on the property page (feature 010 FR-001). Static, so it adds no client code. */
export async function AnalyticsCard({
  locale,
  propertyId,
}: {
  locale: string;
  propertyId: string;
}) {
  const t = await getTranslations("analytics");
  return (
    <section className="card" aria-labelledby={`analytics-card-${propertyId}`}>
      <h2 id={`analytics-card-${propertyId}`}>{t("cardTitle")}</h2>
      <p className="muted">{t("cardBody")}</p>
      <p>
        <Link href={`/${locale}/properties/${propertyId}/analytics`}>{t("open")}</Link>
      </p>
    </section>
  );
}
