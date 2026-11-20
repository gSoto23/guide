import type { GuestGuide } from "@guidesk/contracts";
import { chevron, compass, gift, Icon, phone, sectionIcon, type IconData } from "@guidesk/ui";
import { Item, MapLinks, sectionTitle } from "../components/content.js";
import { Layout, type PageChrome } from "../components/layout.js";
import type { GuestLocale, Translate } from "../i18n.js";

/** Suggested-question keys the API may return (domain `suggestionKeys`). */
const CHAT_SUGGESTIONS = [
  "arrival",
  "wifi",
  "checkout",
  "house_rules",
  "parking",
  "appliances",
  "local_recommendations",
  "amenities",
];

/** Strings the browser script shows (contracts/guide-web.md); it ships no catalog of its own. */
export function clientTexts(t: Translate): Record<string, string> {
  const keys = [
    "locked.public",
    "locked.fallback",
    "locked.before",
    "locked.ended",
    "locked.offline",
    "locked.show",
    "locked.showing",
    "locked.error",
    "locked.viewed",
    "locked.cookies",
    "locked.spelled",
    "verify.title",
    "verify.body",
    "verify.label",
    "verify.submit",
    "verify.cancel",
    "verify.wrong",
    "verify.locked",
    "stay.title",
    "stay.dates",
    "stay.deviceTime",
    "notice.ended",
    "notice.deviceLimit",
    "offline.banner",
    "copy.copy",
    "copy.copied",
    // Feature 005: the chat's texts (research R10); the chat script ships no catalog either.
    "chat.title",
    "chat.close",
    "chat.intro",
    "privacy.link",
    "chat.introNoHost",
    "chat.introEmergency",
    "chat.introPlatform",
    "chat.suggestionsTitle",
    ...CHAT_SUGGESTIONS.map((key) => `chat.suggestions.${key}`),
    "chat.label",
    "chat.placeholder",
    "chat.send",
    "chat.counter",
    "chat.typing",
    "chat.you",
    "chat.assistant",
    "chat.host",
    "chat.source",
    "chat.emergencyTitle",
    "chat.call",
    "chat.paused",
    "chat.tooLong",
    "chat.error",
    "chat.unavailable",
    "chat.loading",
    "chat.offline",
  ];
  const texts: Record<string, string> = {};
  // Placeholders stay as {name} for the script to fill.
  const raw: Record<string, Record<string, string>> = {
    "locked.before": { date: "{date}" },
    "locked.spelled": { characters: "{characters}" },
    "verify.wrong": { count: "{count}" },
    "verify.locked": { minutes: "{minutes}" },
    "stay.dates": { checkIn: "{checkIn}", checkout: "{checkout}" },
    "stay.deviceTime": { time: "{time}" },
    "offline.banner": { time: "{time}" },
    "chat.title": { property: "{property}" },
    "chat.intro": { property: "{property}", host: "{host}" },
    "chat.introNoHost": { property: "{property}" },
    "chat.introEmergency": { number: "{number}" },
    "chat.counter": { count: "{count}" },
    "chat.host": { name: "{name}" },
    "chat.call": { number: "{number}" },
    "chat.paused": { minutes: "{minutes}" },
  };
  for (const key of keys) texts[key] = t(key, raw[key]);
  return texts;
}

export interface GuidePageInput extends PageChrome {
  guide: GuestGuide;
}

function chrome(input: GuidePageInput, path: string) {
  const { guide, locale } = input;
  const other = guide.languages.find((language) => language !== locale) ?? null;
  return {
    publicId: guide.publicId,
    propertyName: guide.propertyName,
    homeHref: `/g/${guide.publicId}/${locale}`,
    emergencyHref: `/g/${guide.publicId}/${locale}/emergency`,
    switchHref: other ? `/g/${guide.publicId}/${other}${path}` : null,
    switchLocale: (other as GuestLocale | null) ?? null,
  };
}

/** A home tile: the section icon, the whole title, and a chevron (feature 015 FR-010, FR-014). */
function Tile({ href, icon, title }: { href: string; icon: IconData; title: string }) {
  return (
    <a className="tile" href={href}>
      <span className="tile-icon">
        <Icon data={icon} size={22} />
      </span>
      <span className="tile-title">{title}</span>
      <Icon data={chevron} size={18} className="tile-chevron" />
    </a>
  );
}

/** G-01: the guide home. */
export function HomePage(input: GuidePageInput) {
  const { guide, t } = input;
  return (
    <Layout
      {...input}
      title={t("meta.title", { property: guide.propertyName })}
      guide={chrome(input, "")}
      clientTexts={clientTexts(t)}
      credit={guide.credit}
    >
      <h1 className="title">{guide.propertyName}</h1>
      <p className="lead">{t("home.intro")}</p>
      <section id="stay-card" className="card stay-card" hidden aria-live="polite" />
      <dl className="facts">
        {guide.facts.checkInTime ? (
          <div>
            <dt>{t("facts.checkIn")}</dt>
            <dd>{t("facts.from", { time: guide.facts.checkInTime })}</dd>
          </div>
        ) : null}
        {guide.facts.checkoutTime ? (
          <div>
            <dt>{t("facts.checkout")}</dt>
            <dd>{t("facts.until", { time: guide.facts.checkoutTime })}</dd>
          </div>
        ) : null}
      </dl>
      <h2 className="visually-hidden">{t("home.sections")}</h2>
      <ul className="tiles">
        {guide.sections.map((section) => (
          <li key={section.id} className={section.kind === "arrival" ? "tile-wide" : undefined}>
            <Tile
              href={`/g/${guide.publicId}/${input.locale}/${section.id}`}
              icon={sectionIcon(section.kind)}
              title={sectionTitle(section, t)}
            />
          </li>
        ))}
        {guide.extras.visible ? (
          <li className="tile-wide tile-extras">
            <Tile
              href={`/g/${guide.publicId}/${input.locale}/extras`}
              icon={gift}
              title={t("extras.tile")}
            />
          </li>
        ) : null}
        {guide.explore.visible ? (
          <li className="tile-wide tile-explore">
            <Tile
              href={`/g/${guide.publicId}/${input.locale}/explore`}
              icon={compass}
              title={t("explore.tile")}
            />
          </li>
        ) : null}
      </ul>
      {guide.facts.address ? (
        <section className="card address">
          <h2 className="card-title">{t("facts.address")}</h2>
          <p>{guide.facts.address}</p>
          <MapLinks address={guide.facts.address} t={t} />
        </section>
      ) : null}
      {input.privacyHref ? (
        <p className="privacy-link">
          <a href={input.privacyHref} target="_blank" rel="noopener">
            {t("privacy.link")}
          </a>
        </p>
      ) : null}
    </Layout>
  );
}

/** G-02 and G-03: one section. */
export function SectionPage(input: GuidePageInput & { sectionId: string }) {
  const { guide, t } = input;
  const section = guide.sections.find((candidate) => candidate.id === input.sectionId)!;
  const title = sectionTitle(section, t);
  let firstMedia = true;
  return (
    <Layout
      {...input}
      title={`${title} · ${guide.propertyName}`}
      guide={chrome(input, `/${section.id}`)}
      clientTexts={clientTexts(t)}
      credit={guide.credit}
    >
      <a className="back" href={`/g/${guide.publicId}/${input.locale}`}>
        {t("nav.back")}
      </a>
      <h1 className="title title-with-icon">
        <span className="tile-icon">
          <Icon data={sectionIcon(section.kind)} size={22} />
        </span>
        <span>{title}</span>
      </h1>
      <div className="items">
        {section.items.map((item) => {
          const eager = firstMedia && (item.kind === "image" || item.kind === "video");
          if (eager) firstMedia = false;
          return (
            <Item
              key={item.id}
              item={item}
              guide={guide}
              sectionTitle={title}
              t={t}
              eager={eager}
            />
          );
        })}
      </div>
    </Layout>
  );
}

/** G-11: emergency, reachable from every page. */
export function EmergencyPage(input: GuidePageInput) {
  const { guide, t } = input;
  const section = guide.sections.find((candidate) => candidate.kind === "emergency");
  return (
    <Layout
      {...input}
      title={`${t("emergency.title")} · ${guide.propertyName}`}
      guide={chrome(input, "/emergency")}
      clientTexts={clientTexts(t)}
    >
      <a className="back" href={`/g/${guide.publicId}/${input.locale}`}>
        {t("nav.back")}
      </a>
      <h1 className="title">{t("emergency.title")}</h1>
      {guide.emergencyNumber ? (
        <section className="card emergency-number">
          <h2 className="card-title">{t("emergency.number")}</h2>
          <a className="button-danger" href={`tel:${guide.emergencyNumber}`}>
            <Icon data={phone} />
            {t("emergency.call", { number: guide.emergencyNumber })}
          </a>
        </section>
      ) : null}
      {section ? (
        <section>
          <h2 className="subtitle">{t("emergency.hostSection")}</h2>
          <div className="items">
            {section.items.map((item) => (
              <Item
                key={item.id}
                item={item}
                guide={guide}
                sectionTitle={t("emergency.title")}
                t={t}
                eager={false}
              />
            ))}
          </div>
        </section>
      ) : null}
    </Layout>
  );
}
