import { setRequestLocale } from "next-intl/server";
import { SharedContent } from "@/components/shared-content/shared-content";

/** Shared content (screen H-29, feature 003 US7). */
export default async function SharedContentPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <SharedContent locale={locale} />
    </main>
  );
}
