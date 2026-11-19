"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanSummary } from "@guidesk/contracts";
import { formatMoment, share } from "@/lib/plan";
import { useWorkspace } from "@/lib/use-workspace";

interface Row {
  key: "properties" | "aiReplies" | "seats";
  used: number;
  limit: number | null;
  notes: string[];
}

/**
 * Plan and limits (feature 011 US4, screen H-32): the plan, each limit with its usage as text and as
 * a bar that repeats the text (FR-016), what counts as an AI reply, the workspace ID, and how to ask
 * Guidesk for a change. Owners and admins only; the API refuses agents too.
 */
export function PlanView({ locale }: { locale: string }) {
  const t = useTranslations("plan");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const api = workspace?.canManage ? workspace.api : null;

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    api
      .get<PlanSummary>("/plan", controller.signal)
      .then(setSummary)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [api]);

  if (!workspace) return <p className="muted">{t("loading")}</p>;
  if (!workspace.canManage) {
    return (
      <>
        <h1>{t("title")}</h1>
        <p className="alert alert-info" role="status">
          {t("noAccess")}
        </p>
      </>
    );
  }
  if (failed) {
    return (
      <>
        <h1>{t("title")}</h1>
        <p className="alert alert-error" role="alert">
          {errors("internal_error")}
        </p>
      </>
    );
  }
  if (!summary) return <p className="muted">{t("loading")}</p>;

  const { limits } = summary;
  const over = (used: number, limit: number | null) => limit !== null && used > limit;
  const rows: Row[] = [
    {
      key: "properties",
      used: limits.properties.used,
      limit: limits.properties.limit,
      notes: [
        ...(limits.properties.source === "custom" ? [t("custom")] : []),
        ...(over(limits.properties.used, limits.properties.limit) ? [t("over")] : []),
      ],
    },
    {
      key: "aiReplies",
      used: limits.aiReplies.used,
      limit: limits.aiReplies.limit,
      notes: [
        ...(limits.aiReplies.source === "custom" ? [t("custom")] : []),
        ...(limits.aiReplies.perProperty
          ? [t("pooled", { perProperty: limits.aiReplies.perProperty })]
          : []),
        t("resets", { date: formatMoment(locale, limits.aiReplies.resetsAt) }),
      ],
    },
    {
      key: "seats",
      used: limits.seats.used,
      limit: limits.seats.limit,
      notes: [
        t("seatsHint", { members: limits.seats.members, pending: limits.seats.pending }),
        ...(limits.seats.source === "custom" ? [t("custom")] : []),
        ...(over(limits.seats.used, limits.seats.limit) ? [t("over")] : []),
      ],
    },
  ];

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>
      <section className="card" aria-labelledby="plan-current">
        <h2 id="plan-current">{t("current", { plan: t(`names.${summary.plan}`) })}</h2>
        {summary.changedAt ? (
          <p className="muted">{t("since", { date: formatMoment(locale, summary.changedAt) })}</p>
        ) : null}
        <ul className="bar-list">
          {rows.map((row) => (
            <li key={row.key} className="bar-row">
              <span>{t(`limits.${row.key}`)}</span>
              <span className="bar-value">
                {row.limit === null
                  ? t("unlimited", { used: row.used })
                  : t("usage", { used: row.used, limit: row.limit })}
              </span>
              {row.limit === null ? null : (
                <span className="bar-track" aria-hidden="true">
                  <span className="bar-fill" style={{ width: `${share(row.used, row.limit)}%` }} />
                </span>
              )}
              {row.notes.map((note) => (
                <span key={note} className="bar-note muted">
                  {note}
                </span>
              ))}
            </li>
          ))}
        </ul>
      </section>
      <section className="card" aria-labelledby="plan-counts">
        <h2 id="plan-counts">{t("whatCountsTitle")}</h2>
        <p>{t("whatCounts")}</p>
      </section>
      <section className="card" aria-labelledby="plan-change">
        <h2 id="plan-change">{t("changeTitle")}</h2>
        <p>{t("changeBody")}</p>
        <p>
          {t("workspaceId")}: <code className="plan-id">{summary.workspaceId}</code>
        </p>
        <p>
          {summary.contactEmail ? (
            <a href={`mailto:${summary.contactEmail}`}>
              {t("contact", { email: summary.contactEmail })}
            </a>
          ) : (
            t("noContact")
          )}
        </p>
      </section>
    </>
  );
}
