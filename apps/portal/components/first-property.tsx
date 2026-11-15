"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMe } from "@/lib/use-me";

/**
 * "Create your first property" (T045): the entry point of feature 002. Managers see the bulk
 * options first; individual hosts see the quick options first (FR-006).
 */
export function FirstProperty({ locale }: { locale: string }) {
  const t = useTranslations("properties");
  const me = useMe(locale);
  const manager = useSearchParams().get("path") === "manager";
  const options = manager
    ? (["pms", "csv", "paste", "manual"] as const)
    : (["paste", "manual", "pms", "csv"] as const);

  if (!me) {
    return <p className="muted">{t("loading")}</p>;
  }

  return (
    <>
      <h1>{t("firstTitle")}</h1>
      <p className="muted">{manager ? t("managerSubtitle") : t("individualSubtitle")}</p>
      {options.map((option) => (
        <div key={option} className="card">
          <strong>{t(`options.${option}.title`)}</strong>
          <p className="muted">{t(`options.${option}.body`)}</p>
        </div>
      ))}
      <p className="alert alert-info" role="status">
        {t("comingSoon")}
      </p>
    </>
  );
}
