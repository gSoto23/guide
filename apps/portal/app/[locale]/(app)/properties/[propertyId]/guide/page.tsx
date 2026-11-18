import { setRequestLocale } from "next-intl/server";
import { GuideReview } from "@/components/guide/guide-review";

/** The guide draft review (screen H-12, feature 003 US1). */
export default async function GuidePage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <GuideReview locale={locale} propertyId={propertyId} />
    </main>
  );
}
