"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { PropertyExplore } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";

/** Explore on the property page (feature 009 US2): how many partner experiences guests see. */
export function ExploreCard({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("explore");
  const workspace = useWorkspace();
  const id = useId();
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (!workspace) return;
    let active = true;
    workspace.api
      .get<PropertyExplore>(
        `/properties/${propertyId}/explore?lang=${locale === "en" ? "en" : "es"}`,
      )
      .then((data) => active && setShown(data.experiences.filter((item) => item.shown).length))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workspace, propertyId, locale]);

  if (!workspace || shown === null) return null;
  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("cardTitle")}</h2>
      <p className="muted">{t("cardBody")}</p>
      <p>{t("cardShown", { count: shown })}</p>
      <p>
        <Link href={`/${locale}/properties/${propertyId}/explore`}>{t("configure")}</Link>
      </p>
    </section>
  );
}
