import { setRequestLocale } from "next-intl/server";
import { InboxView } from "@/components/inbox/inbox-view";

/** The host inbox (feature 006 US1; screen H-20). */
export default async function InboxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ propertyId?: string }>;
}) {
  const { locale } = await params;
  const { propertyId } = await searchParams;
  setRequestLocale(locale);
  return (
    <main>
      <InboxView locale={locale} {...(propertyId ? { initialProperty: propertyId } : {})} />
    </main>
  );
}
