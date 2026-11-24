"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { StartOptions } from "@guidesk/contracts";
import { Illustration, noPropertiesScene } from "@guidesk/ui";
import { useWorkspace } from "@/lib/use-workspace";

/** Message keys of each starting option (properties.options.*). */
const OPTION_KEYS = {
  listing: "paste",
  pms: "pms",
  csv: "csv",
  duplicate: "duplicate",
  blank: "manual",
} as const;

/** Where each option starts. Paths that are not built yet are never returned by the API. */
const OPTION_PATHS = {
  listing: "/properties/new/listing",
  pms: "/properties/new/pms",
  csv: "/properties/new/csv",
  duplicate: "/properties/new/duplicate",
  blank: "/properties/new/blank",
} as const;

/**
 * "Add property" (FR-008, T045): the options the API returns, the recommended one first, from
 * the onboarding answers of spec 001.
 */
export function StartOptionsPanel({
  locale,
  title,
  subtitle,
  icons,
}: {
  locale: string;
  title?: string;
  /** The onboarding path's subtitle on the first-property step (spec 001). */
  subtitle?: string;
  /**
   * One icon per option, rendered by the caller (feature 017 FR-015). The server page renders them,
   * so this client component does not pull the icon table into the route (research R8).
   */
  icons?: Partial<Record<keyof typeof OPTION_KEYS, ReactNode>>;
}) {
  const t = useTranslations("properties");
  const workspace = useWorkspace();
  const [options, setOptions] = useState<StartOptions | null>(null);

  useEffect(() => {
    if (!workspace?.canManage) return;
    const controller = new AbortController();
    workspace.api
      .get<StartOptions>("/properties/start-options", controller.signal)
      .then(setOptions)
      .catch(() => undefined);
    return () => controller.abort();
  }, [workspace]);

  if (!workspace) return <p className="muted">{t("loading")}</p>;
  if (!workspace.canManage) {
    return (
      <>
        <h1>{title ?? t("start.title")}</h1>
        <p className="muted">{t("start.notAllowed")}</p>
      </>
    );
  }
  if (!options) return <p className="muted">{t("loading")}</p>;

  return (
    <>
      <Illustration data={noPropertiesScene} width={180} className="page-illustration" />
      <h1>{title ?? t("start.title")}</h1>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
      <ul className="list-plain option-grid">
        {options.options.map(({ option, recommended }) => (
          <li key={option}>
            <Link
              className={recommended ? "option-card option-card-recommended" : "option-card"}
              href={`/${locale}${OPTION_PATHS[option]}`}
            >
              {icons?.[option] ? (
                <span className="option-icon" aria-hidden="true">
                  {icons[option]}
                </span>
              ) : null}
              <span className="option-text">
                <span className="option-title">
                  <strong>{t(`options.${OPTION_KEYS[option]}.title`)}</strong>
                  {recommended ? (
                    <span className="badge badge-ready">{t("start.recommended")}</span>
                  ) : null}
                </span>
                <span className="option-body">
                  {option === "listing" && !options.screenshotsEnabled
                    ? t("options.paste.bodyTextOnly")
                    : t(`options.${OPTION_KEYS[option]}.body`)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
