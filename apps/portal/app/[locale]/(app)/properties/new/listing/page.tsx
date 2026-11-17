import { setRequestLocale } from "next-intl/server";
import { ListingFlow } from "@/components/properties/listing-flow";

/** Paste a listing or add screenshots, review what was found, and confirm (US2, T062). */
export default async function ListingPropertyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <ListingFlow locale={locale} />
    </main>
  );
}
