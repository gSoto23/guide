"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Stay, StayList } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useWorkspace } from "@/lib/use-workspace";
import { StayForm } from "./stay-form";

const DISMISSED_KEY = "guidesk.overlap-dismissed.";

function isDismissed(stayId: string): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY + stayId) === "1";
  } catch {
    return false;
  }
}

function dismiss(stayId: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY + stayId, "1");
  } catch {
    // Blocked storage: the warning comes back on the next visit, which is harmless.
  }
}

export interface StaysListProps {
  propertyId: string;
  checkInTime: string | null;
  checkoutTime: string | null;
  timeZone: string | null;
  /** Changes when a feed was added, removed, or refreshed, so the list reloads. */
  version: number;
}

/**
 * The property's upcoming stays (FR-021 to FR-024, FR-052 to FR-054, T079), in its time zone:
 * source and channel, "may be a block" with Hide, overlap and "possibly out of date" notices, stays
 * added by hand, and removing a guest's name on request. Agents only read.
 */
export function StaysList(props: StaysListProps) {
  const t = useTranslations("properties.stays");
  const errors = useTranslations("errors");
  const locale = useLocale();
  const workspace = useWorkspace();
  const online = useOnline();
  const [stays, setStays] = useState<Stay[] | null>(null);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [form, setForm] = useState<"new" | Stay | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: "cancel" | "name" } | null>(
    null,
  );
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // A change can add or clear the overlap of other stays: the list is read again after each one.
  const [reload, setReload] = useState(0);
  const { propertyId, version } = props;
  const api = workspace?.api;

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    api
      .get<StayList>(`/properties/${propertyId}/stays`, controller.signal)
      .then((list) => {
        setStays(list.items);
        setDismissed(new Set(list.items.filter((s) => isDismissed(s.id)).map((s) => s.id)));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMessage({ kind: "error", text: errors("internal_error") });
        }
      });
    return () => controller.abort();
  }, [api, propertyId, version, reload, errors]);

  if (!workspace || !api) return null;
  const canManage = workspace.canManage;
  const defaultCheckIn = props.checkInTime ?? "15:00";
  const defaultCheckout = props.checkoutTime ?? "11:00";
  // Stay dates are calendar dates in the property's zone: formatted as UTC so they never shift.
  const day = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const formatDay = (date: string) => day.format(new Date(`${date}T00:00:00Z`));

  function replace(saved: Stay) {
    setStays((current) => {
      const list = current ?? [];
      const others = list.filter((item) => item.id !== saved.id);
      const next = saved.status === "active" ? [...others, saved] : others;
      return next.sort((a, b) => a.checkInDate.localeCompare(b.checkInDate));
    });
    setReload((count) => count + 1);
  }

  async function act(request: () => Promise<Stay>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      replace(await request());
      setConfirming(null);
      setMessage({ kind: "info", text: done });
    } catch (error) {
      const code = problemOf(error)?.code;
      setMessage({
        kind: "error",
        text: errors(
          code && ["conflict", "forbidden", "network", "not_found"].includes(code)
            ? code
            : "internal_error",
        ),
      });
    } finally {
      setBusy(false);
    }
  }

  const channelLabel = (stay: Stay) => (stay.channel === "Direct" ? t("direct") : stay.channel);
  const sourceLabel = (stay: Stay) =>
    stay.source === "ical"
      ? t("source.ical", { channel: channelLabel(stay) })
      : t(`source.${stay.source}`);

  return (
    <section aria-labelledby="stays-title">
      <h2 id="stays-title">{t("title")}</h2>
      <p className="muted">{t("intro", { zone: props.timeZone ?? t("zoneUnknown") })}</p>
      {message ? (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-info"}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
      {stays === null ? <p className="muted">{t("loading")}</p> : null}
      {stays && stays.length === 0 ? <p className="muted">{t("empty")}</p> : null}
      {stays && stays.length > 0 ? (
        <ul className="stay-list">
          {stays.map((stay) => (
            <li key={stay.id} className="content-item">
              <div className="content-item-head">
                <h3>
                  {t("dates", {
                    checkIn: formatDay(stay.checkInDate),
                    checkout: formatDay(stay.checkoutDate),
                  })}
                </h3>
                <span className="badge">{channelLabel(stay)}</span>
              </div>
              <p className="muted">
                {t("times", {
                  checkIn: stay.checkInTime ?? defaultCheckIn,
                  checkout: stay.checkoutTime ?? defaultCheckout,
                })}
                {" · "}
                {sourceLabel(stay)}
                {stay.guestCount ? ` · ${t("guests", { count: stay.guestCount })}` : ""}
              </p>
              {stay.guestName ? <p>{stay.guestName}</p> : null}
              {stay.guestNameRemoved ? <p className="muted">{t("nameRemoved")}</p> : null}
              <p className="property-meta">
                {stay.mayBeBlock ? (
                  <span className="badge badge-warning">{t("mayBeBlock")}</span>
                ) : null}
                {stay.possiblyOutdated ? (
                  <span className="badge badge-warning">{t("possiblyOutdated")}</span>
                ) : null}
              </p>
              {stay.possiblyOutdated ? (
                <p className="field-warning">{t("possiblyOutdatedNote")}</p>
              ) : null}
              {stay.overlaps && !dismissed.has(stay.id) ? (
                <div className="alert alert-info" role="status">
                  {t("overlaps")}
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => {
                      dismiss(stay.id);
                      setDismissed(new Set([...dismissed, stay.id]));
                    }}
                  >
                    {t("dismiss")}
                  </button>
                </div>
              ) : null}
              {canManage && confirming?.id === stay.id ? (
                <div className="confirm">
                  <p>
                    {confirming.action === "cancel" ? t("cancelConfirm") : t("removeNameConfirm")}
                  </p>
                  <div className="content-actions">
                    <button
                      type="button"
                      className="button button-danger"
                      disabled={busy || !online}
                      onClick={() =>
                        confirming.action === "cancel"
                          ? act(() => api.post<Stay>(`/stays/${stay.id}/cancel`), t("cancelled"))
                          : act(
                              () => api.post<Stay>(`/stays/${stay.id}/remove-guest-name`),
                              t("nameRemovedDone"),
                            )
                      }
                    >
                      {confirming.action === "cancel" ? t("cancelYes") : t("removeNameYes")}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => setConfirming(null)}
                    >
                      {t("keep")}
                    </button>
                  </div>
                </div>
              ) : canManage ? (
                <div className="stay-actions">
                  {stay.mayBeBlock && stay.source !== "manual" ? (
                    <button
                      type="button"
                      className="button-link"
                      disabled={busy || !online}
                      onClick={() =>
                        act(
                          () => api.patch<Stay>(`/stays/${stay.id}`, { status: "hidden" }),
                          t("hidden"),
                        )
                      }
                    >
                      {t("hide")}
                    </button>
                  ) : null}
                  {stay.source === "manual" ? (
                    <>
                      <button
                        type="button"
                        className="button-link"
                        disabled={!online}
                        onClick={() => setForm(stay)}
                      >
                        {t("edit")}
                      </button>
                      <button
                        type="button"
                        className="button-link"
                        disabled={!online}
                        onClick={() => setConfirming({ id: stay.id, action: "cancel" })}
                      >
                        {t("cancelStay")}
                      </button>
                    </>
                  ) : null}
                  {stay.guestName ? (
                    <button
                      type="button"
                      className="button-link"
                      disabled={!online}
                      onClick={() => setConfirming({ id: stay.id, action: "name" })}
                    >
                      {t("removeName")}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canManage && form ? (
        <StayForm
          key={form === "new" ? "new" : form.id}
          propertyId={propertyId}
          stay={form === "new" ? undefined : form}
          defaultCheckInTime={defaultCheckIn}
          defaultCheckoutTime={defaultCheckout}
          onCancel={() => setForm(null)}
          onSaved={(saved) => {
            replace(saved);
            setForm(null);
            setMessage({ kind: "info", text: t(form === "new" ? "added" : "saved") });
          }}
        />
      ) : canManage ? (
        <button
          type="button"
          className="button button-secondary"
          disabled={!online}
          onClick={() => {
            setMessage(null);
            setForm("new");
          }}
        >
          {t("add")}
        </button>
      ) : null}
    </section>
  );
}
