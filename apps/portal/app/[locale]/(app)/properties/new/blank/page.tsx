import { setRequestLocale } from "next-intl/server";
import { BlankProperty } from "@/components/properties/blank-property";

/** A blank property: the core-facts confirmation step (US1, T045). */
export default async function BlankPropertyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <BlankProperty locale={locale} />
    </main>
  );
}
