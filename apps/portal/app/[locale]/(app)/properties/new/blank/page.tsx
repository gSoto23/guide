import { getTranslations, setRequestLocale } from "next-intl/server";
import { BlankProperty } from "@/components/properties/blank-property";

/**
 * A blank property: the core-facts confirmation step (US1, T045). The heading renders here on the
 * server, so it is in the first paint instead of waiting for the account to load; it is the page's
 * largest content, so this keeps its Largest Contentful Paint at the first paint.
 */
export default async function BlankPropertyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("properties");
  return (
    <main>
      <h1>{t("facts.title")}</h1>
      <BlankProperty locale={locale} />
    </main>
  );
}
