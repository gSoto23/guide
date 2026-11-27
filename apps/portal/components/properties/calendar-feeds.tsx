"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import type {
  CalendarFeed,
  CalendarFeedList,
  CreatedCalendarFeed,
  FeedChannel,
} from "@guidesk/contracts";
import { problemNumber, problemOf, problemString } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useWorkspace } from "@/lib/use-workspace";

const CHANNELS: FeedChannel[] = ["airbnb", "booking", "vrbo", "other"];
const MAX_FEEDS = 5;
/** Reasons the feed reader gives (sandbox protocol), each with its own message. */
const REASONS = new Set([
  "not_https",
  "blocked_address",
  "dns_failed",
  "too_many_redirects",
  "too_large",
  "timeout",
  "connection_failed",
  "not_ical",
]);

export interface CalendarFeedsProps {
  propertyId: string;
  /** Called when stays may have changed: a feed added or removed, or a refresh queued. */
  onStaysChanged: () => void;
}

/**
 * The property's calendar links (FR-020 to FR-025, T079), for owners and admins only: each link
 * shown masked with its channel, its status, the last successful read, and why it is failing;
 * "Refresh now", at most every 5 minutes per property; adding and removing links.
 */
export function CalendarFeeds({ propertyId, onStaysChanged }: CalendarFeedsProps) {
  const t = useTranslations("properties.calendars");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const workspace = useWorkspace();
  const online = useOnline();
  const [feeds, setFeeds] = useState<CalendarFeed[] | null>(null);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const api = workspace?.api;

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!api) return;
      api
        .get<CalendarFeedList>(`/properties/${propertyId}/calendar-feeds`, signal)
        .then((list) => setFeeds(list.items))
        .catch(() => {
          if (!signal?.aborted) setMessage({ kind: "error", text: errors("internal_error") });
        });
    },
    [api, propertyId, errors],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (!workspace?.canManage || !api) return null;

  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const channelName = (feed: Pick<CalendarFeed, "channel" | "channelLabel">) =>
    feed.channel === "other"
      ? (feed.channelLabel ?? t("channels.other"))
      : t(`channels.${feed.channel}`);
  const reason = (code: string | null) =>
    code && REASONS.has(code)
      ? t(`reasons.${code}`)
      : code?.startsWith("http_")
        ? t("reasons.http", { status: code.slice(5) })
        : t("reasons.internal");

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      await api!.post(`/properties/${propertyId}/calendar-feeds/refresh`);
      setMessage({ kind: "info", text: t("refreshQueued") });
      // The refresh runs in the background; look again once it has had time to finish.
      setTimeout(() => {
        load();
        onStaysChanged();
      }, 8000);
    } catch (error) {
      const problem = problemOf(error);
      if (problem?.code === "refresh_too_soon") {
        const minutes = Math.max(
          1,
          Math.ceil((problemNumber(problem, "retryAfterSeconds") ?? 60) / 60),
        );
        setMessage({ kind: "error", text: t("refreshTooSoon", { minutes }) });
      } else {
        setMessage({
          kind: "error",
          text: errors(problem?.code === "network" ? "network" : "internal_error"),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(feed: CalendarFeed) {
    setBusy(true);
    setMessage(null);
    try {
      await api!.delete(`/calendar-feeds/${feed.id}`);
      setFeeds((current) => (current ?? []).filter((item) => item.id !== feed.id));
      setRemoving(null);
      setMessage({ kind: "info", text: t("removed", { channel: channelName(feed) }) });
      onStaysChanged();
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

  return (
    <section aria-labelledby="calendars-title">
      <h2 id="calendars-title">{t("title")}</h2>
      <p className="muted">{t("intro")}</p>
      {message ? (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-info"}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
      {feeds === null ? <p className="muted">{t("loading")}</p> : null}
      {feeds && feeds.length === 0 && !adding ? <p className="muted">{t("empty")}</p> : null}
      {feeds?.map((feed) => (
        <article key={feed.id} className="content-item">
          <div className="content-item-head">
            <h3>{channelName(feed)}</h3>
            <span
              className={`badge ${feed.status === "failing" ? "badge-warning" : "badge-ready"}`}
            >
              {t(feed.status === "failing" ? "status.failing" : "status.active")}
            </span>
          </div>
          <p className="muted feed-hint">{t("hint", { hint: feed.displayHint })}</p>
          <p className="muted">
            {feed.lastSuccessAt
              ? t("lastSuccess", { time: dateTime.format(new Date(feed.lastSuccessAt)) })
              : t("neverRead")}
          </p>
          {feed.status === "failing" ? (
            <p className="field-error">
              {t("failing", {
                since: feed.failingSince ? dateTime.format(new Date(feed.failingSince)) : "",
                reason: reason(feed.lastErrorCode),
              })}
            </p>
          ) : null}
          {removing === feed.id ? (
            <div className="confirm">
              <p>{t("removeConfirm", { channel: channelName(feed) })}</p>
              <div className="content-actions">
                <button
                  type="button"
                  className="button button-danger"
                  disabled={busy || !online}
                  onClick={() => remove(feed)}
                >
                  {t("removeYes")}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setRemoving(null)}
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="button-link"
              disabled={busy || !online}
              onClick={() => setRemoving(feed.id)}
            >
              {t("remove")}
            </button>
          )}
        </article>
      ))}
      {feeds && feeds.length > 0 ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={busy || !online}
          onClick={refresh}
        >
          {t("refresh")}
        </button>
      ) : null}
      {adding ? (
        <AddFeedForm
          propertyId={propertyId}
          onCancel={() => setAdding(false)}
          onAdded={(created) => {
            setFeeds((current) => [...(current ?? []), created]);
            setAdding(false);
            setMessage({
              kind: "info",
              text: t("added", {
                channel: channelName(created),
                count: created.upcomingStays.length,
              }),
            });
            onStaysChanged();
          }}
          reason={reason}
        />
      ) : feeds && feeds.length < MAX_FEEDS ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={!online}
          onClick={() => {
            setMessage(null);
            setAdding(true);
          }}
        >
          {t("add")}
        </button>
      ) : feeds ? (
        <p className="muted">{t("max", { max: MAX_FEEDS })}</p>
      ) : null}
    </section>
  );
}

function AddFeedForm({
  propertyId,
  onAdded,
  onCancel,
  reason,
}: {
  propertyId: string;
  onAdded: (feed: CreatedCalendarFeed) => void;
  onCancel: () => void;
  reason: (code: string | null) => string;
}) {
  const t = useTranslations("properties.calendars");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const online = useOnline();
  const ids = { url: useId(), channel: useId(), label: useId(), help: useId() };
  const [url, setUrl] = useState("");
  const [channel, setChannel] = useState<"" | FeedChannel>("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!workspace || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await workspace.api.post<CreatedCalendarFeed>(
        `/properties/${propertyId}/calendar-feeds`,
        {
          url: url.trim(),
          ...(channel ? { channel } : {}),
          ...(channel === "other" && label.trim() ? { channelLabel: label.trim() } : {}),
        },
      );
      onAdded(created);
    } catch (caught) {
      const problem = problemOf(caught);
      if (problem?.code === "feed_rejected") {
        setError(reason(problemString(problem, "reason") ?? null));
      } else if (problem?.code === "duplicate_feed") {
        setError(
          t(
            problemString(problem, "reason") === "same_channel"
              ? "duplicateChannel"
              : "duplicateLink",
          ),
        );
      } else if (problem?.code === "validation_failed" && problem.fields?.channelLabel) {
        setChannel("other");
        setError(t("labelRequired"));
      } else if (problem?.code === "validation_failed") {
        setError(t("reasons.not_https"));
      } else {
        setError(
          errors(
            problem && ["feed_limit_reached", "forbidden", "network"].includes(problem.code)
              ? problem.code
              : "internal_error",
          ),
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="content-item">
      <label htmlFor={ids.url}>{t("url")}</label>
      <input
        id={ids.url}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        required
        maxLength={2048}
        placeholder="https://"
        value={url}
        aria-describedby={ids.help}
        onChange={(event) => setUrl(event.target.value)}
      />
      <span className="field-hint" id={ids.help}>
        {t("urlHelp")}
      </span>
      <details className="how-to">
        <summary>{t("howTo.title")}</summary>
        <ul>
          <li>{t("howTo.airbnb")}</li>
          <li>{t("howTo.booking")}</li>
          <li>{t("howTo.vrbo")}</li>
          <li>{t("howTo.other")}</li>
        </ul>
        <p className="muted">{t("howTo.sync")}</p>
      </details>
      <label htmlFor={ids.channel}>{t("channel")}</label>
      <select
        id={ids.channel}
        value={channel}
        onChange={(event) => setChannel(event.target.value as "" | FeedChannel)}
      >
        <option value="">{t("channelDetect")}</option>
        {CHANNELS.map((value) => (
          <option key={value} value={value}>
            {t(`channels.${value}`)}
          </option>
        ))}
      </select>
      {channel === "other" ? (
        <>
          <label htmlFor={ids.label}>{t("label")}</label>
          <input
            id={ids.label}
            required
            maxLength={40}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </>
      ) : null}
      {error ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="button button-primary" disabled={saving || !online}>
        {saving ? t("checking") : t("save")}
      </button>
      <button type="button" className="button button-secondary" onClick={onCancel}>
        {t("cancel")}
      </button>
    </form>
  );
}
