"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/** "See plan and limits" next to a limit message (feature 011 FR-013), for owners and admins. */
export function PlanLink({ locale }: { locale: string }) {
  const t = useTranslations("plan");
  return <Link href={`/${locale}/settings/plan`}>{t("link")}</Link>;
}
