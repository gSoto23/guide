import { setRequestLocale } from "next-intl/server";
import { MembersSettings } from "@/components/members-settings";

export default async function MembersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <MembersSettings locale={locale} />
    </main>
  );
}
