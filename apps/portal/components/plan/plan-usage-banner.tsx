"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanSummary } from "@guidesk/contracts";
import { formatMoment } from "@/lib/plan";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * The month's AI replies at 80% or more (feature 011 FR-015), on every signed-in page for owners
 * and admins, checked again on each navigation. Loaded on demand, so its code is in no route's
 * initial JavaScript.
 */
export function PlanUsageBanner({ locale }: { locale: string }) {
  const t = useTranslations("plan");
  const workspace = useWorkspace();
  const pathname = usePathname();
  const [ai, setAi] = useState<PlanSummary["limits"]["aiReplies"] | null>(null);
  const api = workspace?.canManage ? workspace.api : null;

  useEffect(() => {
    if (!api) {
      setAi(null);
      return;
    }
    const controller = new AbortController();
    api
      .get<PlanSummary>("/plan", controller.signal)
      .then((summary) => setAi(summary.limits.aiReplies))
      .catch(() => {
        // The banner is a convenience; Plan and limits shows the full state.
      });
    return () => controller.abort();
  }, [api, pathname]);

  if (!ai || ai.used * 100 < ai.limit * 80) return null;
  const reached = ai.used >= ai.limit;
  return (
    <p className={`plan-banner${reached ? " plan-banner-reached" : ""}`} role="status">
      {reached
        ? t("bannerReached", { date: formatMoment(locale, ai.resetsAt) })
        : t("bannerWarning", { left: ai.limit - ai.used, limit: ai.limit })}{" "}
      <Link href={`/${locale}/settings/plan`}>{t("link")}</Link>
    </p>
  );
}
