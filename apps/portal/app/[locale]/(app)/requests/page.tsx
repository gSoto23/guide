import { setRequestLocale } from "next-intl/server";
import { RequestsScreen } from "@/components/requests/requests-screen";

/** Add-on requests across the workspace (feature 008 US3; screen H-23). */
export default async function RequestsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="page-wide">
      <RequestsScreen locale={locale} />
    </main>
  );
}
