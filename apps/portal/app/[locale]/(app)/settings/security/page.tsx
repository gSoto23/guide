import { setRequestLocale } from "next-intl/server";
import { SecuritySettings } from "@/components/security-settings";

export default async function SecurityPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <SecuritySettings locale={locale} />
    </main>
  );
}
