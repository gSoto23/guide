"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanSummary } from "@guidesk/contracts";
import { aiState, formatMoment } from "@/lib/plan";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * The month's AI replies at 80% or more (feature 011 FR-015), on every signed-in page for owners
 * and admins, checked again on each navigation: a warning, the month used up with a top-up still
 * answering, or the AI paused with no top-up (feature 019 FR-013). Loaded on demand, so its code is
 * in no route's initial JavaScript.
 */
export function PlanUsageBanner({ locale }: { locale: string }) {
  const t = useTranslations("plan");
  const workspace = useWorkspace();
  const pathname = usePathname();
  const [ai, setAi] = useState<
    (PlanSummary["limits"]["aiReplies"] & { topUpBalance: number }) | null
  >(null);
  const api = workspace?.canManage ? workspace.api : null;

  useEffect(() => {
    if (!api) {
      setAi(null);
      return;
    }
    const controller = new AbortController();
    api
      .get<PlanSummary>("/plan", controller.signal)
      .then((summary) =>
        setAi({ ...summary.limits.aiReplies, topUpBalance: summary.topUps.balance }),
      )
      .catch(() => {
        // The banner is a convenience; Plan and limits shows the full state.
      });
    return () => controller.abort();
  }, [api, pathname]);

  if (!ai) return null;
  const state = aiState(ai, ai.topUpBalance);
  if (state === "ok") return null;
  return (
    <p className={`plan-banner${state === "paused" ? " plan-banner-reached" : ""}`} role="status">
      {state === "paused"
        ? t("bannerReached", { date: formatMoment(locale, ai.resetsAt) })
        : state === "topUp"
          ? t("bannerTopUp", { left: ai.topUpBalance })
          : t("bannerWarning", { left: ai.limit - ai.used, limit: ai.limit })}{" "}
      <Link href={`/${locale}/settings/plan`}>{t("link")}</Link>
    </p>
  );
}
