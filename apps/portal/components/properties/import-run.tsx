"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ImportItem, ImportItemList, ImportRun } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useWorkspace } from "@/lib/use-workspace";

const POLL_MS = 2000;
/** Reason codes with their own message; anything else reads as a provider problem. */
const REASONS = new Set([
  "plan_limit",
  "reconnect_pms",
  "provider_error",
  "not_found_in_pms",
  "workspace_pending_deletion",
]);

/**
 * An import run (FR-029, FR-032, T099): "Importing 12 of 40" while it runs, then each listing's
 * result, the reason for failures and skips, and "Try again" for a failed listing.
 */
export function ImportRunView({ locale, importRunId }: { locale: string; importRunId: string }) {
  const t = useTranslations("properties.imports");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const online = useOnline();
  const [run, setRun] = useState<ImportRun | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const api = workspace?.api;
  const path = `/imports/${encodeURIComponent(importRunId)}`;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!api) return null;
      const [next, list] = await Promise.all([
        api.get<ImportRun>(path, signal),
        api.get<ImportItemList>(`${path}/items`, signal),
      ]);
      setRun(next);
      setItems(list.items);
      return next;
    },
    [api, path],
  );

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await load(controller.signal);
        if (next?.status === "running") timer = setTimeout(tick, POLL_MS);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    void tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, load, version]);

  if (!workspace) return <p className="muted">{t("loading")}</p>;
  if (!workspace.canManage) return <p className="muted">{t("notAllowed")}</p>;
  if (failed) return <p className="alert alert-error">{errors("not_found")}</p>;
  if (!run) return <p className="muted">{t("loading")}</p>;

  async function retry(item: ImportItem) {
    setRetrying(item.id);
    setMessage(null);
    try {
      await api!.post(`${path}/items/${item.id}/retry`);
      setVersion((count) => count + 1);
    } catch (error) {
      const code = problemOf(error)?.code;
      setMessage(errors(code === "network" ? "network" : "internal_error"));
    } finally {
      setRetrying(null);
    }
  }

  const source = run.provider ? t(`sources.${run.provider}`) : t("sources.csv");
  const running = run.status === "running";

  return (
    <>
      <p>
        <Link href={`/${locale}/properties`}>{t("back")}</Link>
      </p>
      <h1>{t("title", { source })}</h1>
      {running ? (
        <p className="working" role="status" aria-live="polite">
          {t("progress", { processed: run.processed, total: run.total })}
        </p>
      ) : (
        <p
          className={`alert ${run.status === "failed" ? "alert-error" : "alert-info"}`}
          role="status"
        >
          {t(run.status === "failed" ? "finishedFailed" : "finished")}
        </p>
      )}
      <dl className="facts-list">
        <dt>{t("counts.created")}</dt>
        <dd>{run.created}</dd>
        <dt>{t("counts.needsDetails")}</dt>
        <dd>{run.needsDetails}</dd>
        <dt>{t("counts.failed")}</dt>
        <dd>{run.failed}</dd>
        <dt>{t("counts.skipped")}</dt>
        <dd>{run.skipped}</dd>
      </dl>
      {message ? (
        <p className="alert alert-error" role="alert">
          {message}
        </p>
      ) : null}
      <ul className="property-list">
        {items.map((item) => (
          <li key={item.id} className="content-item">
            <div className="content-item-head">
              <h3>
                {item.propertyId ? (
                  <Link href={`/${locale}/properties/${item.propertyId}`}>{item.label}</Link>
                ) : (
                  item.label
                )}
              </h3>
              <span
                className={`badge ${
                  item.outcome === "failed" || item.outcome === "skipped"
                    ? "badge-warning"
                    : item.outcome === "pending"
                      ? ""
                      : "badge-ready"
                }`}
              >
                {t(`outcomes.${item.outcome}`)}
              </span>
            </div>
            {item.reasonCode ? (
              <p className="muted">
                {t(`reasons.${REASONS.has(item.reasonCode) ? item.reasonCode : "provider_error"}`)}
              </p>
            ) : null}
            {item.outcome === "failed" && run.kind === "pms" && !running ? (
              <button
                type="button"
                className="button-link"
                disabled={!online || retrying === item.id}
                onClick={() => void retry(item)}
              >
                {t("retry")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!running ? (
        <Link className="button button-secondary" href={`/${locale}/properties`}>
          {t("toProperties")}
        </Link>
      ) : null}
    </>
  );
}
