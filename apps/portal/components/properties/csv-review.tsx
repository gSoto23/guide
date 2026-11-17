"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ImportItem, ImportRun, PropertyLimits } from "@guidesk/contracts";
import { useCsvIssueText } from "@/lib/csv";
import { problemNumber, problemOf, type WorkspaceApi } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";

/**
 * The checked file (US5, FR-039, FR-040, T111): how many rows can be created, the errors by row
 * and column with the error file, the warnings, and, when the rows are more than the plan's free
 * slots, the choice of which to create (US5 scenario 5). Creating continues on the run's page.
 */
export function CsvReview({
  locale,
  api,
  errorFileUrl,
  run,
  items,
  limits,
  onCancelled,
}: {
  locale: string;
  api: WorkspaceApi;
  errorFileUrl: string;
  run: ImportRun;
  items: ImportItem[];
  limits: PropertyLimits;
  onCancelled: () => void;
}) {
  const t = useTranslations("properties.csv.review");
  const errors = useTranslations("errors");
  const issueText = useCsvIssueText();
  const router = useRouter();
  const online = useOnline();
  const valid = items.filter((item) => item.outcome === "pending");
  const withErrors = items.filter((item) => item.errors.length > 0);
  const warned = valid.filter((item) => item.warnings.length > 0);
  const free = Math.max(0, limits.limit - limits.used);
  const mustChoose = valid.length > free;
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(valid.slice(0, free).map((item) => item.rowNumber ?? 0)),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const count = mustChoose ? selected.size : valid.length;
  const path = `/imports/${encodeURIComponent(run.id)}`;

  function toggle(rowNumber: number) {
    const next = new Set(selected);
    if (next.has(rowNumber)) next.delete(rowNumber);
    else next.add(rowNumber);
    setSelected(next);
  }

  async function create() {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`${path}/confirm`, mustChoose ? { rowNumbers: [...selected] } : {});
      router.push(`/${locale}/properties/imports/${run.id}`);
    } catch (error) {
      const problem = problemOf(error);
      setMessage(
        problem?.code === "plan_limit_reached"
          ? t("limitReached", { limit: problemNumber(problem, "limit") ?? limits.limit })
          : problem?.code === "validation_failed"
            ? t("overLimit", { free: problemNumber(problem, "free") ?? free })
            : errors(problem?.code === "network" ? "network" : "internal_error"),
      );
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`${path}/cancel`);
      onCancelled();
    } catch (error) {
      setMessage(errors(problemOf(error)?.code === "network" ? "network" : "internal_error"));
      setBusy(false);
    }
  }

  const rowTitle = (item: ImportItem) =>
    `${t("row", { row: item.rowNumber ?? "?" })} · ${item.label}`;

  return (
    <>
      <h1>{t("title")}</h1>
      <p role="status">{t("summary", { valid: valid.length, invalid: run.failed })}</p>
      {message ? (
        <p className="alert alert-error" role="alert">
          {message}
        </p>
      ) : null}

      {withErrors.length > 0 ? (
        <section aria-labelledby="csv-errors">
          <h2 id="csv-errors">{t("errorsTitle")}</h2>
          <p className="muted">{run.failed > 0 ? t("errorsIntro") : t("linkErrors")}</p>
          <ul className="issue-list">
            {withErrors.map((item) => (
              <li key={item.id}>
                <strong>{rowTitle(item)}</strong>
                <ul>
                  {item.errors.map((issue, index) => (
                    <li key={index}>{issueText(issue)}</li>
                  ))}
                </ul>
                {item.outcome === "pending" ? <p className="muted">{t("withoutLink")}</p> : null}
              </li>
            ))}
          </ul>
          <p>
            <a className="button button-secondary" href={errorFileUrl} download>
              {t("errorFile")}
            </a>
          </p>
        </section>
      ) : null}

      {warned.length > 0 ? (
        <details className="issue-details">
          <summary>
            {t("warningsTitle")} ({warned.length})
          </summary>
          <p className="muted">{t("warningsIntro")}</p>
          <ul className="issue-list">
            {warned.map((item) => (
              <li key={item.id}>
                <strong>{rowTitle(item)}</strong>
                <ul>
                  {item.warnings.map((issue, index) => (
                    <li key={index}>{issueText(issue)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {valid.length === 0 ? (
        <p className="alert alert-info">{t("noneValid")}</p>
      ) : mustChoose && free > 0 ? (
        <section aria-labelledby="csv-choose">
          <h2 id="csv-choose">{t("chooseTitle")}</h2>
          <p className="muted">{t("chooseIntro", { free, limit: limits.limit })}</p>
          <ul className="choice-list">
            {valid.map((item) => (
              <li key={item.id}>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={selected.has(item.rowNumber ?? 0)}
                    onChange={() => toggle(item.rowNumber ?? 0)}
                  />
                  <span>{rowTitle(item)}</span>
                </label>
              </li>
            ))}
          </ul>
          {selected.size > free ? (
            <p className="alert alert-info" role="status">
              {t("overLimit", { free })}
            </p>
          ) : null}
        </section>
      ) : free === 0 ? (
        <p className="alert alert-info">{t("limitReached", { limit: limits.limit })}</p>
      ) : null}

      <div className="actions">
        {valid.length > 0 && free > 0 ? (
          <button
            type="button"
            className="button button-primary"
            disabled={busy || !online || count === 0 || count > free}
            onClick={() => void create()}
          >
            {busy ? t("creating") : t("create", { count })}
          </button>
        ) : null}
        <button
          type="button"
          className="button button-secondary"
          disabled={busy || !online}
          onClick={() => void cancel()}
        >
          {t("cancel")}
        </button>
      </div>
    </>
  );
}
