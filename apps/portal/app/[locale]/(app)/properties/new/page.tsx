import { getTranslations, setRequestLocale } from "next-intl/server";
import { START_OPTION_ICONS } from "@/components/properties/start-option-icons";
import { StartOptionsPanel } from "@/components/properties/start-options";

/**
 * "Add property": the starting options, the recommended one first (FR-008, T045). Coming from
 * onboarding (`?path=`), it is spec 001's first-property step, with the subtitle of the host's
 * path (spec 001 V1 to V3).
 */
export default async function NewPropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ path?: string }>;
}) {
  const { locale } = await params;
  const { path } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("properties");
  const first = path === "manager" || path === "individual";
  return (
    <main>
      <StartOptionsPanel
        locale={locale}
        icons={START_OPTION_ICONS}
        {...(first
          ? {
              title: t("firstTitle"),
              subtitle: t(path === "manager" ? "managerSubtitle" : "individualSubtitle"),
            }
          : {})}
      />
    </main>
  );
}
