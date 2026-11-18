import { setRequestLocale } from "next-intl/server";
import { GuideReview } from "@/components/guide/guide-review";

/** The guide draft review (screen H-12, feature 003 US1) and its publishing actions (US3). */
export default async function GuidePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
  searchParams: Promise<{ restored?: string }>;
}) {
  const { locale, propertyId } = await params;
  const { restored } = await searchParams;
  setRequestLocale(locale);
  const restoredVersion = restored && /^[1-9]\d{0,5}$/.test(restored) ? Number(restored) : null;
  return (
    <main>
      <GuideReview locale={locale} propertyId={propertyId} restoredVersion={restoredVersion} />
    </main>
  );
}
