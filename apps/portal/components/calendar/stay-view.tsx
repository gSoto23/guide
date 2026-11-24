"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { StayOverview } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import { GuestForm } from "./guest-form";

function money(locale: string, amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function day(locale: string, date: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/**
 * One stay (feature 018 US2, US3): dates and source, the guest, the stay link's state, the stay's
 * conversations, and its add-on requests with their payments and totals. Owners and admins edit the
 * guest and reach the Share screen; members who answer requests may confirm a waiting one here.
 */
export function StayView({ locale, stayId }: { locale: string; stayId: string }) {
  const t = useTranslations("stayView");
  const c = useTranslations("calendar");
  const stays = useTranslations("properties.stays");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [view, setView] = useState<StayOverview | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const api = workspace?.api;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!api) return;
      try {
        setView(await api.get<StayOverview>(`/stays/${stayId}?lang=${locale}`, signal));
      } catch {
        if (!signal?.aborted) setMissing(true);
      }
    },
    [api, stayId, locale],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function confirm(requestId: string) {
    if (!api) return;
    setNotice(null);
    try {
      await api.post(`/service-requests/${requestId}/confirm?lang=${locale}`);
      await load();
    } catch (caught) {
      setNotice({ kind: "error", text: errors(problemOf(caught)?.code ?? "internal_error") });
    }
  }

  async function copyReference(reference: string) {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const back = (
    <p>
      <Link href={`/${locale}/calendar`}>← {t("back")}</Link>
    </p>
  );
  if (missing) {
    return (
      <>
        {back}
        <p className="alert alert-error" role="alert">
          {t("notFound")}
        </p>
      </>
    );
  }
  if (!view) return <p className="muted">{t("loading")}</p>;
  const { stay, property } = view;
  const guestLabel = stay.guestName ?? t("noGuest");

  return (
    <>
      {back}
      <h1>
        {stay.guestName ?? property.name}
        {stay.guestName ? <span className="muted"> · {property.name}</span> : null}
      </h1>
      {notice ? (
        <p
          className={`alert alert-${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}
      <div className="stay-view">
        <section className="card" aria-labelledby="stay-dates">
          <h2 id="stay-dates">{t("dates")}</h2>
          <p>
            {t("checkIn", { date: day(locale, stay.checkInDate), time: stay.checkInTime ?? "—" })}
          </p>
          <p>
            {t("checkout", {
              date: day(locale, stay.checkoutDate),
              time: stay.checkoutTime ?? "—",
            })}
          </p>
          <p className="muted">
            {t(`sources.${stay.source}`, { channel: stay.channel })}
            {stay.mayBeBlock ? ` · ${c("mayBeBlock")}` : ""}
            {stay.status === "cancelled" ? ` · ${c("cancelled")}` : ""}
            {stay.overlaps ? ` · ${stays("overlaps")}` : ""}
          </p>
          {stay.bookingReference ? (
            <p>
              {t("reference")}: <code>{stay.bookingReference}</code>{" "}
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => void copyReference(stay.bookingReference!)}
              >
                {copied ? t("copied") : t("copy")}
              </button>
            </p>
          ) : null}
        </section>

        <section className="card" aria-labelledby="stay-guest">
          <h2 id="stay-guest">{t("guest")}</h2>
          {editing ? (
            <GuestForm
              stayId={stay.id}
              name={stay.guestName}
              count={stay.guestCount}
              submitLabel={t("save")}
              onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                setNotice({ kind: "success", text: t("saved") });
                void load();
              }}
            />
          ) : (
            <>
              <p>
                <strong>{guestLabel}</strong>
                {stay.guestCount !== null ? ` · ${stay.guestCount}` : ""}
              </p>
              {stay.guestNameRemoved ? <p className="muted">{t("nameRemoved")}</p> : null}
              {stay.guestDetails.source === "host" && stay.guestDetails.setAt ? (
                <p className="muted">
                  {t("detailsBy", {
                    name: stay.guestDetails.setBy ?? "—",
                    date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                      new Date(stay.guestDetails.setAt),
                    ),
                  })}
                </p>
              ) : null}
              {view.canManage ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setEditing(true)}
                >
                  {t("edit")}
                </button>
              ) : null}
            </>
          )}
        </section>

        <section className="card" aria-labelledby="stay-link">
          <h2 id="stay-link">{t("link")}</h2>
          <p>
            <span className="badge">{t(`linkStatus.${view.link.status}`)}</span>
          </p>
          <p className="muted">
            {t("devices", { count: view.link.devices })} ·{" "}
            {t("valuesShown", { count: view.link.valuesShown })}
          </p>
          {view.canManage ? (
            <p>
              <Link href={`/${locale}/properties/${property.id}/share`}>{t("share")}</Link>
            </p>
          ) : null}
        </section>

        <section className="card" aria-labelledby="stay-conversations">
          <h2 id="stay-conversations">{t("conversations")}</h2>
          {view.conversations.length === 0 ? (
            <p className="muted">{t("noConversations")}</p>
          ) : (
            <ul className="stay-list">
              {view.conversations.map((item) => (
                <li key={item.id}>
                  <Link href={`/${locale}/properties/${property.id}/conversations/${item.id}`}>
                    {t("openConversation")}
                  </Link>
                  {item.status === "needs_host" ? (
                    <span className="badge badge-warning"> ! {item.reason ?? ""}</span>
                  ) : null}
                  {item.lastMessageAt ? (
                    <span className="muted">
                      {" "}
                      ·{" "}
                      {new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(item.lastMessageAt))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card stay-services" aria-labelledby="stay-services">
          <h2 id="stay-services">{t("services")}</h2>
          {view.requests.length === 0 ? (
            <p className="muted">{t("noServices")}</p>
          ) : (
            <>
              <ul className="stay-list">
                {view.requests.map((request) => (
                  <li key={request.id}>
                    <strong>
                      {request.name} × {request.quantity}
                    </strong>{" "}
                    · {money(locale, request.price * request.quantity, request.currency)}
                    {request.requestedDate ? ` · ${day(locale, request.requestedDate)}` : ""}
                    {request.requestedTime ? ` ${request.requestedTime.slice(0, 5)}` : ""}{" "}
                    <span className="badge">{t(`requestStatus.${request.status}`)}</span>
                    {request.payment ? (
                      <span className="muted">
                        {" "}
                        · {t("paymentState", { state: request.payment.state })}
                      </span>
                    ) : null}
                    {request.status === "waiting" ? (
                      <span className="actions">
                        <button
                          type="button"
                          className="button button-small"
                          onClick={() => void confirm(request.id)}
                        >
                          {t("confirm")}
                        </button>
                        <Link href={`/${locale}/requests`}>{t("openRequests")}</Link>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {view.totals.map((total) => (
                <p key={total.currency}>
                  {t("totals", {
                    confirmed: money(locale, total.confirmed, total.currency),
                    paid: money(locale, total.paid, total.currency),
                  })}
                </p>
              ))}
            </>
          )}
        </section>
      </div>
    </>
  );
}
