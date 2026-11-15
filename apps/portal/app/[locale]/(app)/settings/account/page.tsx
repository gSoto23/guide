import { setRequestLocale } from "next-intl/server";
import { AccountSettings } from "@/components/account-settings";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <AccountSettings locale={locale} />
    </main>
  );
}
