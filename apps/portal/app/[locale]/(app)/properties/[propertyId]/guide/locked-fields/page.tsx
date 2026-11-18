import { setRequestLocale } from "next-intl/server";
import { LockedFields } from "@/components/guide/locked-fields";

/** Locked fields (screen H-18, feature 003 US2). */
export default async function LockedFieldsPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <LockedFields locale={locale} propertyId={propertyId} />
    </main>
  );
}
