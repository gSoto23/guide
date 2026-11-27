"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { PropertyDetail } from "@guidesk/contracts";

/** The guide counts as built from this completeness on (feature 022 clarification). */
const GUIDE_BUILT_AT = 80;

interface Step {
  key: "details" | "calendar" | "guide" | "publish";
  done: boolean;
  optional?: boolean;
  href: string;
  body: string;
}

/**
 * The property's setup steps as cards with their state (feature 022 FR-008, Enso R8): details,
 * calendar (optional), the guide, and publishing. The first step not done carries the main button;
 * once every step is done the card goes away.
 */
export function SetupSteps({ locale, property }: { locale: string; property: PropertyDetail }) {
  const t = useTranslations("properties.steps");
  const guidePath = `/${locale}/properties/${property.id}/guide`;
  const completeness = property.guide?.completeness ?? 0;
  const published = property.guide?.status === "published";
  const steps: Step[] = [
    {
      key: "details",
      done: property.setupStatus === "ready",
      href: "#property-facts",
      body: t("detailsBody"),
    },
    {
      key: "calendar",
      done: property.calendarStatus !== "none" || property.source === "pms",
      optional: true,
      href: "#calendars-title",
      body: t("calendarBody"),
    },
    {
      key: "guide",
      done: published || completeness >= GUIDE_BUILT_AT,
      href: guidePath,
      body: t("guideBody", { percent: completeness }),
    },
    { key: "publish", done: published, href: guidePath, body: t("publishBody") },
  ];
  if (steps.every((step) => step.done)) return null;
  const next =
    steps.find((step) => !step.done && !step.optional) ?? steps.find((step) => !step.done);

  return (
    <section className="card setup-steps" aria-labelledby="setup-steps-title">
      <h2 id="setup-steps-title">{t("title")}</h2>
      <ol className="setup-step-list">
        {steps.map((step, index) => {
          const isNext = step === next;
          const action = t(`${step.key}Action`);
          const link = step.href.startsWith("#") ? (
            <a className={isNext ? "button button-primary" : "button-link"} href={step.href}>
              {action}
            </a>
          ) : (
            <Link className={isNext ? "button button-primary" : "button-link"} href={step.href}>
              {action}
            </Link>
          );
          return (
            <li
              key={step.key}
              className={`setup-step${step.done ? " is-done" : ""}${isNext ? " is-next" : ""}`}
              aria-current={isNext ? "step" : undefined}
            >
              <span className="setup-step-mark" aria-hidden="true">
                {step.done ? "✓" : index + 1}
              </span>
              <div className="setup-step-body">
                <p>
                  <strong>{t(step.key)}</strong>{" "}
                  <span className={step.done ? "badge badge-ready" : "badge"}>
                    {step.done ? t("done") : step.optional ? t("optional") : t("pending")}
                  </span>
                </p>
                <p className="muted">{step.body}</p>
                {!step.done ? link : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
