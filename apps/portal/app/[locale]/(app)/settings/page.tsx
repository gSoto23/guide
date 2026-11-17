import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";

const SECTIONS = ["workspace", "team", "integrations", "account", "security", "log"] as const;
const PATHS: Record<(typeof SECTIONS)[number], string> = {
  workspace: "settings/workspace",
  team: "settings/members",
  integrations: "settings/integrations",
  account: "settings/account",
  security: "settings/security",
  log: "settings/security-log",
};

/** Settings index (T099): one tap from the header to every settings screen. */
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("settings");
  return (
    <main>
      <h1>{t("title")}</h1>
      <ul className="settings-list">
        {SECTIONS.map((section) => (
          <li key={section}>
            <Link className="card settings-link" href={`/${locale}/${PATHS[section]}`}>
              {t(`sections.${section}`)}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
