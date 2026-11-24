"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanSummary } from "@guidesk/contracts";
import { askMoreHref, formatDay, formatMoment, share } from "@/lib/plan";
import { useWorkspace } from "@/lib/use-workspace";

interface Row {
  key: "properties" | "aiReplies" | "seats";
  used: number;
  limit: number | null;
  notes: string[];
}

/**
 * Plan and limits (feature 011 US4, screen H-32): the plan, each limit with its usage as text and as
 * a bar that repeats the text (FR-016), the AI reply top-ups with their expiry and how to ask for
 * more (feature 019 US4), what counts as an AI reply, the workspace ID, and how to ask Guidesk for a
 * change. Owners and admins only; the API refuses agents too.
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

  const { limits, topUps } = summary;
  // Replies above the month's allowance came from top-ups (or were already in flight).
  const fromTopUps = Math.max(0, limits.aiReplies.used - limits.aiReplies.limit);
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
      used: Math.min(limits.aiReplies.used, limits.aiReplies.limit),
      limit: limits.aiReplies.limit,
      notes: [
        ...(limits.aiReplies.source === "custom" ? [t("custom")] : []),
        ...(limits.aiReplies.perProperty
          ? [
              t("pooled", {
                perProperty: limits.aiReplies.perProperty,
                minimum: limits.aiReplies.minimum ?? limits.aiReplies.perProperty,
              }),
            ]
          : []),
        ...(fromTopUps > 0 ? [t("fromTopUps", { count: fromTopUps })] : []),
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
      <section className="card" aria-labelledby="plan-top-ups">
        <h2 id="plan-top-ups">{t("topUpsTitle")}</h2>
        <p className="muted">{t("topUpsIntro")}</p>
        {topUps.balance > 0 ? (
          <>
            <p>{t("topUpsBalance", { balance: topUps.balance })}</p>
            <ul className="bar-list">
              {topUps.items.map((item) => (
                <li key={item.id} className="bar-row">
                  <span className="bar-value">
                    {t("topUpItem", {
                      remaining: item.remaining,
                      granted: item.granted,
                      date: formatDay(locale, item.expiresAt),
                    })}
                  </span>
                  <span className="bar-track" aria-hidden="true">
                    <span
                      className="bar-fill"
                      style={{ width: `${share(item.remaining, item.granted)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{t("topUpsNone")}</p>
        )}
        <p>{t("askMoreBody")}</p>
        <p>
          {summary.contactEmail ? (
            <a
              className="button button-secondary"
              href={askMoreHref(
                summary.contactEmail,
                t("askMoreSubject", { workspaceId: summary.workspaceId }),
              )}
            >
              {t("askMore")}
            </a>
          ) : (
            t("noContact")
          )}
        </p>
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
