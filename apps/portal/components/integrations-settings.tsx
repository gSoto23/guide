"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { PmsConnection, PmsConnectionList, PmsDisconnectResult } from "@guidesk/contracts";
import { problemNumber, problemOf } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * PMS connections (FR-035, FR-036, T101): status and last refresh, "Refresh now", importing more,
 * reconnecting, and disconnecting. When Guidesk could not revoke the token at the provider, the
 * host is told where to delete it.
 */
export function IntegrationsSettings({ locale }: { locale: string }) {
  const t = useTranslations("settings.integrations");
  const providers = useTranslations("properties.providers");
  const errors = useTranslations("errors");
  const language = useLocale();
  const workspace = useWorkspace();
  const online = useOnline();
  const [connections, setConnections] = useState<PmsConnection[] | null>(null);
  const [message, setMessage] = useState<{
    kind: "info" | "error";
    text: string;
    url?: string;
  } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = workspace?.canManage ? workspace.api : null;

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!api) return;
      api
        .get<PmsConnectionList>("/pms-connections", signal)
        .then((list) => setConnections(list.items))
        .catch(() => {
          if (!signal?.aborted) setConnections([]);
        });
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!workspace) return <p className="muted">{t("loading")}</p>;
  if (!workspace.canManage) return <p className="muted">{t("notAllowed")}</p>;
  if (!connections) return <p className="muted">{t("loading")}</p>;

  const dateTime = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });

  async function refresh(connection: PmsConnection) {
    setBusy(true);
    setMessage(null);
    try {
      await api!.post(`/pms-connections/${connection.id}/refresh`);
      setMessage({ kind: "info", text: t("refreshQueued") });
      setTimeout(() => load(), 8000);
    } catch (error) {
      const problem = problemOf(error);
      setMessage({
        kind: "error",
        text:
          problem?.code === "refresh_too_soon"
            ? t("refreshTooSoon", {
                minutes: Math.max(
                  1,
                  Math.ceil((problemNumber(problem, "retryAfterSeconds") ?? 60) / 60),
                ),
              })
            : errors(problem?.code === "network" ? "network" : "internal_error"),
      });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(connection: PmsConnection) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api!.delete<PmsDisconnectResult>(`/pms-connections/${connection.id}`);
      setConfirming(null);
      setMessage(
        result.providerRevoked
          ? { kind: "info", text: t("disconnected") }
          : {
              kind: "info",
              text: t("disconnectedDeleteToken", { provider: providers(connection.provider) }),
              ...(result.instructionsUrl ? { url: result.instructionsUrl } : {}),
            },
      );
      load();
    } catch (error) {
      const code = problemOf(error)?.code;
      setMessage({
        kind: "error",
        text: errors(code === "network" ? "network" : "internal_error"),
      });
    } finally {
      setBusy(false);
    }
  }

  const active = connections.filter((connection) => connection.status !== "disconnected");

  return (
    <>
      <p>
        <Link href={`/${locale}/settings`}>{t("back")}</Link>
      </p>
      <h1>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>
      {message ? (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-info"}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}{" "}
          {message.url ? (
            <a href={message.url} target="_blank" rel="noopener noreferrer">
              {t("howToDelete")}
            </a>
          ) : null}
        </p>
      ) : null}
      {active.length === 0 ? <p className="muted">{t("empty")}</p> : null}
      {active.map((connection) => (
        <article key={connection.id} className="content-item">
          <div className="content-item-head">
            <h3>{providers(connection.provider)}</h3>
            <span
              className={`badge ${connection.status === "failing" ? "badge-warning" : "badge-ready"}`}
            >
              {t(`status.${connection.status}`)}
            </span>
          </div>
          <p className="muted">{connection.accountLabel}</p>
          <p className="muted">
            {connection.lastRefreshAt
              ? t("lastRefresh", { time: dateTime.format(new Date(connection.lastRefreshAt)) })
              : t("neverRefreshed")}
          </p>
          {connection.status === "failing" ? (
            <p className="field-error">
              {t(
                connection.lastErrorCode === "invalid_credential"
                  ? "failingCredential"
                  : "failingProvider",
              )}
            </p>
          ) : null}
          {confirming === connection.id ? (
            <div className="confirm">
              <p>{t("disconnectConfirm", { provider: providers(connection.provider) })}</p>
              <div className="content-actions">
                <button
                  type="button"
                  className="button button-danger"
                  disabled={busy || !online}
                  onClick={() => void disconnect(connection)}
                >
                  {t("disconnectYes")}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setConfirming(null)}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          ) : (
            <div className="stay-actions">
              <button
                type="button"
                className="button-link"
                disabled={busy || !online}
                onClick={() => void refresh(connection)}
              >
                {t("refresh")}
              </button>
              <Link
                className="button-link"
                href={`/${locale}/properties/new/pms?connection=${connection.id}`}
              >
                {t("importMore")}
              </Link>
              <Link
                className="button-link"
                href={`/${locale}/properties/new/pms?provider=${connection.provider}`}
              >
                {t("reconnect")}
              </Link>
              <button
                type="button"
                className="button-link"
                disabled={busy || !online}
                onClick={() => setConfirming(connection.id)}
              >
                {t("disconnect")}
              </button>
            </div>
          )}
        </article>
      ))}
      <Link className="button button-secondary" href={`/${locale}/properties/new/pms`}>
        {t("connect")}
      </Link>
    </>
  );
}
