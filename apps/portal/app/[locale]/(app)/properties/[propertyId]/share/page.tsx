import { setRequestLocale } from "next-intl/server";
import { ShareScreen } from "@/components/share/share-screen";

/** Share the guide (feature 004 H-16). */
export default async function SharePage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <ShareScreen locale={locale} propertyId={propertyId} />
    </main>
  );
}
