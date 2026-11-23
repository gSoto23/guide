import Link from "next/link";
import {
  bookmark,
  chart,
  chat,
  doorScene,
  gift,
  Icon,
  type IconData,
  Illustration,
  message,
} from "@guidesk/ui";
import type { PublicCatalog } from "@/lib/public/catalog";
import { planCards } from "@/lib/public/plans";

/** One icon per feature (feature 017 FR-022); unknown ids show no icon. */
const FEATURE_ICONS: Record<string, IconData> = {
  guide: bookmark,
  chat,
  copilot: message,
  extras: gift,
  analytics: chart,
};

/** The home page's sections (feature 014 FR-001 to FR-003). Server components only. */
export function HomeSections({ locale, catalog }: { locale: string; catalog: PublicCatalog }) {
  const home = catalog.home;
  const plans = planCards(locale, catalog);
  return (
    <>
      <section className="public-hero" aria-labelledby="hero-title">
        <div className="public-container public-hero-layout">
          <div>
            <p className="public-eyebrow">{home.hero.eyebrow}</p>
            <h1 id="hero-title">{home.hero.title}</h1>
            <p className="public-lead">{home.hero.lead}</p>
            <div className="public-actions">
              <Link href={`/${locale}/sign-in`} className="button button-primary">
                {home.hero.cta}
              </Link>
              <Link href={`/${locale}/sign-in`} className="public-text-link">
                {home.hero.secondary}
              </Link>
            </div>
          </div>
          <Illustration data={doorScene} width={440} className="public-hero-art" />
        </div>
      </section>

      <section className="public-section" aria-labelledby="audience-title">
        <div className="public-container">
          <h2 id="audience-title">{home.audience.title}</h2>
          <div className="public-grid public-grid-2">
            {home.audience.items.map((item) => (
              <div key={item.title} className="public-card">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="public-section public-section-alt" aria-labelledby="steps-title">
        <div className="public-container">
          <h2 id="steps-title">{home.steps.title}</h2>
          <ol className="public-steps">
            {home.steps.items.map((step) => (
              <li key={step.title}>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="public-section" aria-labelledby="features-title">
        <div className="public-container">
          <h2 id="features-title">{home.features.title}</h2>
          <div className="public-grid public-feature-grid">
            {home.features.items.map((feature) => (
              <div key={feature.id} className="public-card">
                {FEATURE_ICONS[feature.id] ? (
                  <span className="feature-icon" aria-hidden="true">
                    <Icon data={FEATURE_ICONS[feature.id]!} size={22} />
                  </span>
                ) : null}
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="plans"
        className="public-section public-section-alt"
        aria-labelledby="plans-title"
      >
        <div className="public-container">
          <h2 id="plans-title">{home.plans.title}</h2>
          <p className="public-lead-small">{home.plans.lead}</p>
          <p className="public-badge">{home.plans.pilot}</p>
          <div className="public-grid public-grid-3">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={
                  plan.id === "pro"
                    ? "public-card public-plan public-plan-featured"
                    : "public-card public-plan"
                }
              >
                <h3>{plan.name}</h3>
                <p className="public-plan-audience">{plan.audience}</p>
                <p className="public-plan-price">{plan.price}</p>
                <ul>
                  {plan.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="public-plan-fee">{plan.fee}</p>
              </div>
            ))}
          </div>
          <p className="public-note">{home.plans.feesNote}</p>
        </div>
      </section>

      <section className="public-section public-cta" aria-labelledby="cta-title">
        <div className="public-container">
          <h2 id="cta-title">{home.cta.title}</h2>
          <p>{home.cta.text}</p>
          <div className="public-actions">
            <Link href={`/${locale}/sign-in`} className="button button-primary">
              {home.cta.button}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
