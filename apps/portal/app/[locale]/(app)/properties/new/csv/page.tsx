import { setRequestLocale } from "next-intl/server";
import { CsvImportFlow } from "@/components/properties/csv-import";

/** Create many properties from a spreadsheet (US5, T111). */
export default async function CsvImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <CsvImportFlow locale={locale} />
    </main>
  );
}
