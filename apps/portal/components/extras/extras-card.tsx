"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { MemberExtras } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";

/** Extras on the property page (feature 008 US1): how many extras guests see. */
export function ExtrasCard({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("extras");
  const workspace = useWorkspace();
  const id = useId();
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (!workspace) return;
    let active = true;
    workspace.api
      .get<MemberExtras>(`/properties/${propertyId}/extras`)
      .then((data) => active && setShown(data.extras.filter((extra) => extra.visible).length))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workspace, propertyId]);

  if (!workspace || shown === null) return null;
  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("cardTitle")}</h2>
      <p className="muted">{t("cardBody")}</p>
      <p>{t("cardCount", { count: shown })}</p>
      <p>
        <Link href={`/${locale}/properties/${propertyId}/extras`}>{t("configure")}</Link>
      </p>
    </section>
  );
}
