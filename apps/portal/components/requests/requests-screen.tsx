"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  MemberServiceRequest,
  PropertyList,
  ServiceRequestPage,
  ServiceRequestReason,
} from "@guidesk/contracts";
import { ANSWER_REASONS } from "@/lib/extras";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import { formatPrice } from "../extras/property-extras";
import { RequestPayment } from "../payments/request-payment";

type StatusFilter = "all" | "waiting" | "confirmed" | "closed";
type Answering = { request: MemberServiceRequest; action: "decline" | "cancel" } | null;

const BADGE: Record<MemberServiceRequest["status"], string> = {
  waiting: "badge badge-warning",
  confirmed: "badge badge-ready",
  declined: "badge",
  cancelled: "badge",
  host_cancelled: "badge",
  expired: "badge",
};

/**
 * Requests across the workspace (feature 008 US3, FR-016 to FR-020; screen H-23): waiting first,
 * soonest date first; filters by property and status; confirm, decline with a reason, or cancel a
 * confirmed one. The first answer wins; a stale answer reloads the list.
 */
export function RequestsScreen({ locale }: { locale: string }) {
  const t = useTranslations("requests");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const id = useId();
  const lang = locale === "en" ? "en" : "es";
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState<ServiceRequestPage | null>(null);
  const [answering, setAnswering] = useState<Answering>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const query = useCallback(
    (before?: string) => {
      const params = new URLSearchParams({ status, lang });
      if (propertyId) params.set("propertyId", propertyId);
      if (before) params.set("before", before);
      return `/service-requests?${params.toString()}`;
    },
    [status, lang, propertyId],
  );

  const load = useCallback(async () => {
    if (!workspace) return;
    setPage(await workspace.api.get<ServiceRequestPage>(query()));
  }, [workspace, query]);

  useEffect(() => {
    void load().catch(() => setMessage({ kind: "error", text: errors("internal_error") }));
  }, [load, errors]);

  useEffect(() => {
    if (!workspace) return;
    workspace.api
      .get<PropertyList>("/properties?limit=100")
      .then((list) =>
        setProperties(
          list.items
            .filter((item) => item.status === "active")
            .map((item) => ({ id: item.id, name: item.name })),
        ),
      )
      .catch(() => undefined);
  }, [workspace]);

  if (!workspace || !page) return null;

  async function more() {
    if (!workspace || !page?.next) return;
    const next = await workspace.api.get<ServiceRequestPage>(query(page.next));
    setPage({ ...next, items: [...page.items, ...next.items] });
  }

  async function answer(
    request: MemberServiceRequest,
    action: "confirm" | "decline" | "cancel",
    body?: { reasonCode: ServiceRequestReason; reasonText?: string },
  ) {
    if (!workspace) return;
    setBusy(true);
    setMessage(null);
    try {
      await workspace.api.post(`/service-requests/${request.id}/${action}?lang=${lang}`, body);
      setAnswering(null);
      await load();
      setMessage({
        kind: "success",
        text: t(
          action === "confirm" ? "confirmed" : action === "decline" ? "declined" : "cancelledDone",
        ),
      });
    } catch (cause) {
      const code = problemOf(cause)?.code;
      setAnswering(null);
      await load().catch(() => undefined);
      setMessage({
        kind: "error",
        text:
          code === "not_waiting"
            ? t("notWaiting")
            : code === "not_confirmed"
              ? t("notConfirmed")
              : code && errors.has(code)
                ? errors(code)
                : errors("internal_error"),
      });
    } finally {
      setBusy(false);
    }
  }

  const dateTime = (iso: string) =>
    new Intl.DateTimeFormat(lang === "en" ? "en-US" : "es-CR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));

  return (
    <section aria-labelledby={`${id}-title`} className="requests">
      <h1 id={`${id}-title`}>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>
      <p>{t("waitingCount", { count: page.waiting })}</p>
      <div className="inbox-controls">
        <label htmlFor={`${id}-property`}>{t("filterProperty")}</label>
        <select
          id={`${id}-property`}
          value={propertyId}
          onChange={(event) => setPropertyId(event.target.value)}
        >
          <option value="">{t("allProperties")}</option>
          {properties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-status`}>{t("filterStatus")}</label>
        <select
          id={`${id}-status`}
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
        >
          {(["all", "waiting", "confirmed", "closed"] as const).map((value) => (
            <option key={value} value={value}>
              {t(`statusFilter.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <div role="status" aria-live="polite">
        {message && (
          <p className={`alert ${message.kind === "success" ? "alert-success" : "alert-error"}`}>
            {message.text}
          </p>
        )}
      </div>
      <p className="muted">{t("payment")}</p>

      {page.items.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ul className="list-plain request-list">
          {page.items.map((request) => (
            <li key={request.id} className="card request-row">
              <h2>
                {request.name}{" "}
                <span className={BADGE[request.status]}>{t(`status.${request.status}`)}</span>
              </h2>
              <p className="muted">{request.propertyName}</p>
              <ul className="list-plain">
                <li>
                  {request.requestedDate
                    ? t("when", {
                        when: `${request.requestedDate}${request.requestedTime ? ` ${request.requestedTime}` : ""}`,
                      })
                    : t("noDate")}
                </li>
                <li>{t("quantity", { count: request.quantity })}</li>
                <li>
                  {t("price", {
                    price: formatPrice(locale, request.price, request.currency, t("free")),
                  })}
                </li>
                <li>
                  {t("stay", {
                    checkIn: request.stay.checkInDate,
                    checkout: request.stay.checkoutDate,
                  })}
                </li>
                {request.stay.guestName && <li>{t("guest", { name: request.stay.guestName })}</li>}
                {request.status === "waiting" && (
                  <li>{t("expires", { at: dateTime(request.expiresAt) })}</li>
                )}
                {request.answeredBy && request.answeredAt && (
                  <li>
                    {t("answeredBy", {
                      status: t(`status.${request.status}`),
                      name: request.answeredBy,
                      at: dateTime(request.answeredAt),
                    })}
                  </li>
                )}
                {request.reasonCode && (
                  <li>
                    {t(`reasons.${request.reasonCode}`)}
                    {request.reasonText ? `: ${request.reasonText}` : ""}
                  </li>
                )}
              </ul>
              {request.payment && (
                <RequestPayment
                  locale={locale}
                  payment={request.payment}
                  canRefund={workspace?.canManage ?? false}
                  onChange={(payment) =>
                    setPage((current) =>
                      current
                        ? {
                            ...current,
                            items: current.items.map((item) =>
                              item.id === request.id ? { ...item, payment } : item,
                            ),
                          }
                        : current,
                    )
                  }
                />
              )}
              {request.note && (
                <>
                  <h3>{t("note")}</h3>
                  {/* Guest text, shown as plain text only. */}
                  <p className="transcript-text">{request.note}</p>
                </>
              )}
              {answering?.request.id === request.id ? (
                <ReasonForm
                  action={answering.action}
                  busy={busy}
                  onSend={(body) => void answer(request, answering.action, body)}
                  onBack={() => setAnswering(null)}
                />
              ) : (
                <div className="actions">
                  {request.status === "waiting" && (
                    <>
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={busy}
                        onClick={() => void answer(request, "confirm")}
                      >
                        {t("confirm")}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy}
                        onClick={() => setAnswering({ request, action: "decline" })}
                      >
                        {t("decline")}
                      </button>
                    </>
                  )}
                  {request.status === "confirmed" && (
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => setAnswering({ request, action: "cancel" })}
                    >
                      {t("cancelConfirmed")}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {page.next && (
        <p>
          <button type="button" className="button button-secondary" onClick={() => void more()}>
            {t("more")}
          </button>
        </p>
      )}
    </section>
  );
}

/** A reason from the list plus optional text for the guest (FR-017). */
function ReasonForm({
  action,
  busy,
  onSend,
  onBack,
}: {
  action: "decline" | "cancel";
  busy: boolean;
  onSend: (body: { reasonCode: ServiceRequestReason; reasonText?: string }) => void;
  onBack: () => void;
}) {
  const t = useTranslations("requests");
  const id = useId();
  const [reasonCode, setReasonCode] = useState<ServiceRequestReason>("unavailable");
  const [reasonText, setReasonText] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = reasonText.trim();
    onSend({ reasonCode, ...(text ? { reasonText: text } : {}) });
  }

  return (
    <form
      className="reason-form"
      onSubmit={submit}
      aria-label={t(action === "decline" ? "decline" : "cancelConfirmed")}
    >
      <fieldset className="choices">
        <legend>{t("reasonLegend")}</legend>
        {ANSWER_REASONS.map((value) => (
          <label key={value} className="checkbox">
            <input
              type="radio"
              name={`${id}-reason`}
              checked={reasonCode === value}
              onChange={() => setReasonCode(value)}
            />
            {t(`reasons.${value}`)}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${id}-text`}>{t("reasonText")}</label>
      <textarea
        id={`${id}-text`}
        value={reasonText}
        maxLength={200}
        rows={2}
        aria-describedby={`${id}-hint`}
        onChange={(event) => setReasonText(event.target.value)}
      />
      <p className="field-hint" id={`${id}-hint`}>
        {t("reasonTextHint")}
      </p>
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {t("send")}
        </button>
        <button type="button" className="button button-secondary" onClick={onBack}>
          {t("back")}
        </button>
      </div>
    </form>
  );
}
