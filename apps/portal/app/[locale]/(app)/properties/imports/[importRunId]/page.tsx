import { setRequestLocale } from "next-intl/server";
import { ImportRunView } from "@/components/properties/import-run";

/** An import run: progress, then per-listing results with reasons and retry (US4, T099). */
export default async function ImportRunPage({
  params,
}: {
  params: Promise<{ locale: string; importRunId: string }>;
}) {
  const { locale, importRunId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <ImportRunView locale={locale} importRunId={importRunId} />
    </main>
  );
}
