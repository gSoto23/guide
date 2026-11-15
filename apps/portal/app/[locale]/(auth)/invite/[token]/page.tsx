import { setRequestLocale } from "next-intl/server";
import { InvitationAccept } from "@/components/invitation-accept";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <InvitationAccept locale={locale} token={token} />
    </main>
  );
}
