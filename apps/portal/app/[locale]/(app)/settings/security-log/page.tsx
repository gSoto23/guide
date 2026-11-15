import { setRequestLocale } from "next-intl/server";
import { SecurityLog } from "@/components/security-log";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <SecurityLog locale={locale} />
    </main>
  );
}
