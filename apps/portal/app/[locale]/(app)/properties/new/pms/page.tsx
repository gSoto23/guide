import { setRequestLocale } from "next-intl/server";
import { PmsFlow } from "@/components/properties/pms-flow";

/** Import from a PMS: connect, choose listings, and import in the background (US4, T098). */
export default async function PmsImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ connection?: string; provider?: string }>;
}) {
  const { locale } = await params;
  const { connection, provider } = await searchParams;
  setRequestLocale(locale);
  return (
    <main>
      <PmsFlow locale={locale} connectionId={connection ?? null} provider={provider ?? null} />
    </main>
  );
}
