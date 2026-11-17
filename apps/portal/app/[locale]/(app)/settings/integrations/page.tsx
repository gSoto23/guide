import { setRequestLocale } from "next-intl/server";
import { IntegrationsSettings } from "@/components/integrations-settings";

/** Settings → Integrations: PMS connections (US4, T101). */
export default async function IntegrationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <IntegrationsSettings locale={locale} />
    </main>
  );
}
