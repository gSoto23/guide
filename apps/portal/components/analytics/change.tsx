"use client";

import { useTranslations } from "next-intl";
import type { PeriodCount } from "@guidesk/contracts";
import type { Formatters } from "@/lib/analytics";

/** The change against the previous period (FR-004, research R7). */
export function Change({
  value,
  days,
  comparable,
  format,
}: {
  value: PeriodCount;
  days: number;
  comparable: boolean;
  format: Formatters;
}) {
  const t = useTranslations("analytics.change");
  // The screen says once, at the top, that there is nothing to compare with yet.
  if (!comparable) return null;
  const diff = value.current - value.previous;
  if (diff === 0) return <p className="metric-change">{t("same", { days })}</p>;
  const abs = format.number(Math.abs(diff));
  const up = diff > 0;
  const text =
    value.previous === 0
      ? t(up ? "upNoRate" : "downNoRate", { abs, days })
      : t(up ? "up" : "down", {
          abs,
          days,
          rel: format.percent(Math.abs(diff) / value.previous),
        });
  return <p className={`metric-change ${up ? "metric-up" : "metric-down"}`}>{text}</p>;
}
