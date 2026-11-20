import type { ExperienceCard, GuestExplore, GuestGuide } from "@guidesk/contracts";
import { Recommendation } from "../components/content.js";
import { coverPreview, Layout, type PageChrome } from "../components/layout.js";
import type { GuestLocale, Translate } from "../i18n.js";
import { clientTexts } from "./guide-pages.js";

/**
 * Explore (feature 009 screens G-07 and G-14): the host's tips first, then partner experiences by
 * category with the commission disclosure on the list, every card, and the detail (FR-002 to FR-006,
 * FR-012). Partner text is rendered as text; "Book" goes through Guidesk's click address (R8).
 */
export interface ExplorePageInput extends PageChrome {
  guide: GuestGuide;
  explore: GuestExplore;
}

function chrome(input: ExplorePageInput, path: string) {
  const { guide, locale } = input;
  const other = guide.languages.find((language) => language !== locale) ?? null;
  return {
    publicId: guide.publicId,
    propertyName: guide.propertyName,
    homeHref: `/g/${guide.publicId}/${locale}`,
    emergencyHref: `/g/${guide.publicId}/${locale}/emergency`,
    switchHref: other ? `/g/${guide.publicId}/${other}${path}` : null,
    switchLocale: (other as GuestLocale | null) ?? null,
    previewImage: coverPreview(guide.cover, input.guideUrl),
  };
}

function exploreTexts(t: Translate): Record<string, string> {
  return { ...clientTexts(t), "explore.offline": t("explore.offline") };
}

function price(card: ExperienceCard, locale: GuestLocale): string | null {
  if (card.priceFrom === null || !card.currency) return null;
  try {
    return new Intl.NumberFormat(locale === "es" ? "es-CR" : "en-US", {
      style: "currency",
      currency: card.currency,
      maximumFractionDigits: card.priceFrom % 1 === 0 ? 0 : 2,
    }).format(card.priceFrom);
  } catch {
    return `${card.priceFrom} ${card.currency}`;
  }
}

function duration(card: ExperienceCard, t: Translate): string | null {
  if (!card.durationMinutes) return null;
  return t("explore.duration", {
    hours: Math.floor(card.durationMinutes / 60),
    minutes: card.durationMinutes % 60,
  }).trim();
}

function Meta({ card, t, locale }: { card: ExperienceCard; t: Translate; locale: GuestLocale }) {
  const from = price(card, locale);
  const time = duration(card, t);
  return (
    <ul className="experience-meta">
      {time ? <li>{time}</li> : null}
      {from ? <li>{t("explore.from", { price: from })}</li> : null}
      {card.rating !== null && card.reviewCount !== null ? (
        <li>
          {t("explore.rating", {
            rating: card.rating.toLocaleString(locale, { maximumFractionDigits: 1 }),
            count: card.reviewCount,
          })}
        </li>
      ) : null}
      <li>{t("explore.partner", { partner: card.partnerName })}</li>
    </ul>
  );
}

function Photo({ card, eager }: { card: ExperienceCard; eager: boolean }) {
  if (!card.image) {
    return (
      <div className={`experience-photo experience-photo-${card.category}`} aria-hidden="true" />
    );
  }
  return (
    <img
      className="experience-photo"
      src={card.image.url}
      width={card.image.width}
      height={card.image.height}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

function LanguageNote({
  card,
  t,
  locale,
}: {
  card: ExperienceCard;
  t: Translate;
  locale: GuestLocale;
}) {
  if (card.language !== locale) return <p className="muted">{t("explore.englishOnly")}</p>;
  if (card.machineTranslated) return <p className="muted">{t("explore.machine")}</p>;
  return null;
}

/** G-07: Explore. */
export function ExplorePage(input: ExplorePageInput) {
  const { guide, explore, t, locale } = input;
  const base = `/g/${guide.publicId}/${locale}/explore`;
  const hasExperiences = explore.categories.length > 0;
  let first = true;
  return (
    <Layout
      {...input}
      title={`${t("explore.title")} · ${guide.propertyName}`}
      guide={chrome(input, "/explore")}
      clientTexts={exploreTexts(t)}
    >
      <a className="back" href={`/g/${guide.publicId}/${locale}`}>
        {t("nav.back")}
      </a>
      <h1 className="title" data-explore-page="list">
        {t("explore.title")}
      </h1>
      {explore.tips.length > 0 ? (
        <section aria-labelledby="explore-tips">
          <h2 id="explore-tips" className="subtitle">
            {t("explore.tips")}
          </h2>
          <div className="items">
            {explore.tips.map((tip, index) => (
              <Recommendation key={`${tip.name}-${index}`} rec={tip} t={t} />
            ))}
          </div>
        </section>
      ) : null}
      {hasExperiences ? (
        <section aria-labelledby="explore-near">
          <h2 id="explore-near" className="subtitle">
            {explore.city ? t("explore.near", { city: explore.city }) : t("explore.nearNoCity")}
          </h2>
          <p className="disclosure" role="note">
            {t("explore.disclosure")}
          </p>
          {explore.categories.map((group) => (
            <section key={group.category} aria-labelledby={`category-${group.category}`}>
              <h3 id={`category-${group.category}`} className="category-title">
                {t(`explore.categories.${group.category}`)}
              </h3>
              <ul className="experiences">
                {group.experiences.map((card) => {
                  const eager = first;
                  first = false;
                  return (
                    <li key={card.ref} className="card experience">
                      <Photo card={card} eager={eager} />
                      <h4 className="experience-title">
                        <a href={`${base}/${card.ref}`}>{card.title}</a>
                      </h4>
                      <Meta card={card} t={t} locale={locale} />
                      <p className="disclosure" role="note">
                        {t("explore.disclosure")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </section>
      ) : explore.tips.length === 0 ? (
        <p className="muted">{t("explore.empty")}</p>
      ) : null}
    </Layout>
  );
}

/** G-14: one experience, with the disclosure next to the button. */
export function ExperiencePage(input: ExplorePageInput & { card: ExperienceCard }) {
  const { guide, card, t, locale } = input;
  const go = `/api/v1/guest/guides/${guide.publicId}/experiences/${card.ref}/go?lang=${locale}`;
  return (
    <Layout
      {...input}
      title={`${card.title} · ${guide.propertyName}`}
      guide={chrome(input, `/explore/${card.ref}`)}
      clientTexts={exploreTexts(t)}
    >
      <a className="back" href={`/g/${guide.publicId}/${locale}/explore`}>
        {t("explore.back")}
      </a>
      <h1 className="title" data-explore-page="detail">
        {card.title}
      </h1>
      <Photo card={card} eager />
      <Meta card={card} t={t} locale={locale} />
      <LanguageNote card={card} t={t} locale={locale} />
      {card.description ? (
        <section>
          <h2 className="subtitle">{t("explore.description")}</h2>
          <p className="experience-description">{card.description}</p>
        </section>
      ) : null}
      {card.includes ? (
        <section>
          <h2 className="subtitle">{t("explore.includes")}</h2>
          <p className="experience-description">{card.includes}</p>
        </section>
      ) : null}
      <div className="card experience-book">
        <p className="disclosure" role="note">
          {t("explore.disclosure")}
        </p>
        <a
          className="button-primary"
          href={go}
          target="_blank"
          rel="noopener noreferrer nofollow"
          data-experience-ref={card.ref}
        >
          {t("explore.book", { partner: card.partnerName })}
        </a>
        <p className="muted">{t("explore.bookNote", { partner: card.partnerName })}</p>
        <p className="muted" data-book-offline hidden>
          {t("explore.offline")}
        </p>
      </div>
    </Layout>
  );
}

export function findCard(explore: GuestExplore, ref: string): ExperienceCard | null {
  for (const group of explore.categories) {
    const card = group.experiences.find((candidate) => candidate.ref === ref);
    if (card) return card;
  }
  return null;
}

/** Keeps partner photos only from hosts the CSP allows; others show the category illustration. */
export function allowImages(explore: GuestExplore, origins: readonly string[]): GuestExplore {
  const allowed = new Set(origins);
  const keep = (card: ExperienceCard): ExperienceCard => {
    if (!card.image) return card;
    try {
      return allowed.has(new URL(card.image.url).origin) ? card : { ...card, image: null };
    } catch {
      return { ...card, image: null };
    }
  };
  return {
    ...explore,
    categories: explore.categories.map((group) => ({
      ...group,
      experiences: group.experiences.map(keep),
    })),
  };
}
