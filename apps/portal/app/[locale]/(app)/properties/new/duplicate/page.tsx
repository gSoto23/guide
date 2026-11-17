import { setRequestLocale } from "next-intl/server";
import { DuplicateProperty } from "@/components/properties/duplicate-property";

/** Copy a property: pick it, then confirm the copy's facts (US6, T119). */
export default async function DuplicatePropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { locale } = await params;
  const { from } = await searchParams;
  setRequestLocale(locale);
  return (
    <main>
      <DuplicateProperty locale={locale} from={from ?? null} />
    </main>
  );
}
