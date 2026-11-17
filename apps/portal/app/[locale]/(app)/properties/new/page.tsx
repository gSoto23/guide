import { setRequestLocale } from "next-intl/server";
import { StartOptionsPanel } from "@/components/properties/start-options";

/** "Add property": the starting options, the recommended one first (FR-008, T045). */
export default async function NewPropertyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <StartOptionsPanel locale={locale} />
    </main>
  );
}
