import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  chat,
  clock,
  coin,
  compass,
  gauge,
  Icon,
  type IconData,
  link,
  people,
  person,
  shield,
  sliders,
} from "@guidesk/ui";
import { PageHeader } from "@/components/shell/page-header";

type Section =
  | "workspace"
  | "plan"
  | "payouts"
  | "team"
  | "assistant"
  | "explore"
  | "integrations"
  | "account"
  | "security"
  | "log";

/** Settings in three groups (feature 017 FR-018): the workspace, what guests get, and you. */
const GROUPS: readonly { id: "workspace" | "guests" | "you"; sections: readonly Section[] }[] = [
  { id: "workspace", sections: ["workspace", "plan", "payouts", "team"] },
  { id: "guests", sections: ["assistant", "explore", "integrations"] },
  { id: "you", sections: ["account", "security", "log"] },
];

const PATHS: Record<Section, string> = {
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

const ICONS: Record<Section, IconData> = {
  workspace: sliders,
  plan: gauge,
  payouts: coin,
  team: people,
  assistant: chat,
  explore: compass,
  integrations: link,
  account: person,
  security: shield,
  log: clock,
};

/**
 * Settings index (T099): one tap from the navigation to every settings screen. Each area is a card
 * with its icon and a one-line description, rendered on the server (feature 017 FR-018).
 */
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("settings");
  return (
    <main className="page-wide">
      <PageHeader title={t("title")} help={t("help")} />
      {GROUPS.map((group) => (
        <section key={group.id} className="settings-group" aria-labelledby={`settings-${group.id}`}>
          <h2 id={`settings-${group.id}`}>{t(`groups.${group.id}`)}</h2>
          <ul className="settings-list settings-grid">
            {group.sections.map((section) => (
              <li key={section}>
                <Link className="option-card settings-card" href={`/${locale}/${PATHS[section]}`}>
                  <span className="option-icon" aria-hidden="true">
                    <Icon data={ICONS[section]} size={22} />
                  </span>
                  <span className="option-text">
                    <strong>{t(`sections.${section}`)}</strong>
                    <span className="option-body">{t(`descriptions.${section}`)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
