import { setRequestLocale } from "next-intl/server";
import { AssistantSettingsForm } from "@/components/assistant/assistant-settings-form";

/** The workspace's assistant settings (feature 007 US1, US3, US4; screen H-26). */
export default async function AssistantSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <AssistantSettingsForm locale={locale} />
    </main>
  );
}
