import { setRequestLocale } from "next-intl/server";
import { Poster } from "@/components/share/poster";

/** The printable QR poster (feature 004 FR-037). */
export default async function PosterPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <Poster locale={locale} propertyId={propertyId} />
    </main>
  );
}
