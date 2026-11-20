"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AnalyticsSummary, PeriodCount } from "@guidesk/contracts";
import { formatters, PERIODS, rate, sum, type PeriodValue } from "@/lib/analytics";
import { Illustration, noDataScene } from "@guidesk/ui";
import { PageHeader } from "@/components/shell/page-header";
import { useWorkspace } from "@/lib/use-workspace";
import { BarList } from "./bar-list";
import { Change } from "./change";
import { PropertyTable } from "./property-table";
import { UnansweredList } from "./unanswered-list";

/**
 * Analytics for a property or the whole workspace (feature 010, screen H-34): a period control, number
 * cards with their change, bars that are also text, the property table, and unanswered questions.
 */
export function AnalyticsView({ locale, propertyId }: { locale: string; propertyId?: string }) {
  const t = useTranslations("analytics");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const id = useId();
  const format = useMemo(() => formatters(locale), [locale]);
  const [period, setPeriod] = useState<PeriodValue>("30");
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    let active = true;
    const params = new URLSearchParams({ period });
    if (propertyId) params.set("propertyId", propertyId);
    setFailed(false);
    workspace.api
      .get<AnalyticsSummary>(`/analytics?${params}`)
      .then((loaded) => active && setData(loaded))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [workspace, period, propertyId]);

  if (!workspace) return null;
  const days = Number(period);
  const title =
    data?.scope.kind === "property"
      ? t("propertyTitle", { name: data.scope.propertyName })
      : propertyId
        ? t("title")
        : t("workspaceTitle");

  const metric = (label: string, value: PeriodCount, extra?: ReactNode) => (
    <div className="metric card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{format.number(value.current)}</p>
      {extra}
      {data ? (
        <Change value={value} days={days} comparable={data.comparable} format={format} />
      ) : null}
    </div>
  );
  const share = (label: string, value: number | null, hint: string, emptyHint: string) => (
    <div className="metric card">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value === null ? t("noRate") : format.percent(value)}</p>
      <p className="field-hint">{value === null ? emptyHint : hint}</p>
    </div>
  );

  let body: ReactNode;
  if (failed) body = <p className="alert alert-error">{errors("internal_error")}</p>;
  else if (!data) body = <p className="muted">{t("loading")}</p>;
  else {
    const q = data.questions;
    const views = sum(data.views.property, data.views.stay);
    const empty =
      views.current + q.total.current + data.explore.opens.current + data.requests.made.current ===
      0;
    const outcomes = [
      { key: "automatic", name: t("metrics.automatic"), value: q.automatic.current },
      { key: "withHost", name: t("metrics.withHost"), value: q.withHost.current },
      { key: "escalated", name: t("metrics.escalated"), value: q.escalated.current },
    ].map((row) => ({
      ...row,
      display: format.number(row.value),
      detail:
        q.total.current > 0
          ? t("share", { share: format.percent(row.value / q.total.current) })
          : undefined,
    }));
    body = (
      <>
        {data.period.utcFallback ? <p className="alert alert-info">{t("utcNote")}</p> : null}
        {data.scope.kind === "property" && data.scope.removed ? (
          <p className="alert alert-warning">{t("removedNote")}</p>
        ) : null}
        {empty ? (
          <div className="empty-state">
            <Illustration data={noDataScene} width={200} />
            <p>{t("empty")}</p>
          </div>
        ) : null}
        {data.comparable ? null : <p className="alert alert-info">{t("change.none", { days })}</p>}

        <h2>{t("sections.guide")}</h2>
        <div className="metric-grid">
          {metric(
            t("metrics.views"),
            views,
            <p className="field-hint">
              {t("metrics.viewsSplit", {
                property: format.number(data.views.property.current),
                stay: format.number(data.views.stay.current),
              })}
            </p>,
          )}
          {metric(t("metrics.staysOpened"), data.staysOpened)}
        </div>

        <h2>{t("sections.chat")}</h2>
        <div className="metric-grid">
          {metric(t("metrics.questions"), q.total)}
          {share(
            t("metrics.resolution"),
            rate(q.automatic.current, q.total.current),
            t("metrics.resolutionHint"),
            t("noRateHint"),
          )}
        </div>
        <BarList label={t("outcomesLabel")} rows={outcomes} empty={t("noneYet")} />

        <h2>{t("sections.topics")}</h2>
        <BarList
          label={t("sections.topics")}
          rows={data.topics.map((row) => ({
            key: row.topic,
            name: t(`topics.${row.topic}`),
            value: row.count,
            display: format.number(row.count),
          }))}
          empty={t("noneYet")}
        />

        <h2>{t("sections.escalations")}</h2>
        <BarList
          label={t("sections.escalations")}
          rows={data.escalations.map((row) => ({
            key: row.reason,
            name: t(`reasons.${row.reason}`),
            value: row.count,
            display: format.number(row.count),
          }))}
          empty={t("noneYet")}
        />

        <h2>{t("sections.unanswered")}</h2>
        <UnansweredList
          locale={locale}
          period={period}
          propertyId={propertyId}
          format={format}
          showProperty={!propertyId}
        />

        <h2>{t("sections.explore")}</h2>
        <div className="metric-grid">{metric(t("metrics.exploreOpens"), data.explore.opens)}</div>
        <h3>{t("metrics.clicks")}</h3>
        <BarList
          label={t("metrics.clicks")}
          rows={data.explore.clicks.map((row) => ({
            key: row.partner,
            name:
              row.partner === "viator" || row.partner === "civitatis"
                ? t(`partners.${row.partner}`)
                : row.partner,
            value: row.count,
            display: format.number(row.count),
          }))}
          empty={t("noneYet")}
        />
        <p className="field-hint">{t("clicksNote")}</p>

        <h2>{t("sections.requests")}</h2>
        <div className="metric-grid">
          {metric(t("metrics.requestsMade"), data.requests.made)}
          {share(
            t("metrics.attach"),
            rate(data.requests.staysWithRequest, data.staysOpened.current),
            t("metrics.attachHint"),
            t("noAttachHint"),
          )}
        </div>
        <h3>{t("byStatus")}</h3>
        <BarList
          label={t("byStatus")}
          rows={data.requests.byStatus.map((row) => ({
            key: row.status,
            name: t(`statuses.${row.status}`),
            value: row.count,
            display: format.number(row.count),
          }))}
          empty={t("noneYet")}
        />

        {data.properties ? (
          <>
            <h2>{t("sections.properties")}</h2>
            <PropertyTable locale={locale} rows={data.properties} format={format} />
          </>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby={`${id}-title`} className="analytics">
      <PageHeader title={title} titleId={`${id}-title`} help={t("intro")} />
      {propertyId ? (
        <p>
          <Link href={`/${locale}/analytics`}>{t("allProperties")}</Link>
        </p>
      ) : null}
      <fieldset className="segmented">
        <legend>{t("periodLegend")}</legend>
        {PERIODS.map((value) => (
          <label key={value} className={value === period ? "tab tab-active" : "tab"}>
            <input
              type="radio"
              name={`${id}-period`}
              value={value}
              checked={value === period}
              onChange={() => setPeriod(value)}
            />
            {t(`periods.${value}`)}
          </label>
        ))}
      </fieldset>
      <div aria-live="polite" aria-busy={!data && !failed}>
        {body}
      </div>
    </section>
  );
}
