import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/shell/page-header";

const SECTIONS = [
  "workspace",
  "plan",
  "payouts",
  "team",
  "assistant",
  "explore",
  "integrations",
  "account",
  "security",
  "log",
] as const;
const PATHS: Record<(typeof SECTIONS)[number], string> = {
  workspace: "settings/workspace",
  plan: "settings/plan",
  payouts: "settings/payouts",
  team: "settings/members",
  assistant: "settings/assistant",
  explore: "settings/explore",
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
      <PageHeader title={t("title")} />
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
