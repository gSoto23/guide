import { setRequestLocale } from "next-intl/server";
import { StartRedirect } from "@/components/start-redirect";

/** Where every sign-in lands: it opens the right screen in the last-used workspace (FR-024). */
export default async function StartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <StartRedirect locale={locale} />
    </main>
  );
}
