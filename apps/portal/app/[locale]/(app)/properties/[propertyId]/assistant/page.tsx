import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AssistantSettingsForm } from "@/components/assistant/assistant-settings-form";

/** A property's assistant settings and "test the assistant" (feature 007 US1 to US5; H-26). */
export default async function PropertyAssistantPage({
  params,
}: {
  params: Promise<{ locale: string; propertyId: string }>;
}) {
  const { locale, propertyId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("assistant");
  return (
    <main>
      <p>
        <Link href={`/${locale}/properties/${propertyId}`}>{t("backToProperty")}</Link>
      </p>
      <AssistantSettingsForm locale={locale} propertyId={propertyId} />
    </main>
  );
}
