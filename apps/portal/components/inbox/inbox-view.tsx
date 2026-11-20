"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  InboxItem,
  InboxPage,
  InboxTab,
  PropertyList,
  TrustSuggestion,
} from "@guidesk/contracts";
import { Icon, inboxClearScene, message, reasonIconData } from "@guidesk/ui";
import { EmptyState } from "@/components/empty-state";
import { AlertsCard } from "@/components/notifications/alerts-card";
import { PageHeader } from "@/components/shell/page-header";
import { useWorkspace } from "@/lib/use-workspace";

const REFRESH_MS = 15_000;
const TABS: InboxTab[] = ["needs", "all", "done"];

/**
 * The host inbox (feature 006 US1, US5, US6; screen H-20): Needs you, All, and Done, emergencies
 * first, filter by property, refreshed every 15 seconds while visible; who is replying; trust
 * suggestions; the alerts banner; and the copilot entry. Offline, the last list stays readable.
 */
export function InboxView({
  locale,
  initialProperty,
}: {
  locale: string;
  initialProperty?: string;
}) {
  const t = useTranslations("inbox");
  const reasons = useTranslations("conversations.reasons");
  const topics = useTranslations("assistant.autonomy.topics");
  const workspace = useWorkspace();
  const id = useId();
  const [tab, setTab] = useState<InboxTab>("needs");
  const [propertyId, setPropertyId] = useState<string>(initialProperty ?? "");
  const [properties, setProperties] = useState<PropertyList["items"]>([]);
  const [page, setPage] = useState<InboxPage | null>(null);
  const [extra, setExtra] = useState<InboxItem[]>([]);
  const [online, setOnline] = useState(true);

  const query = useCallback(
    (before?: string) => {
      const params = new URLSearchParams({ tab });
      if (propertyId) params.set("propertyId", propertyId);
      if (before) params.set("before", before);
      return `/inbox?${params.toString()}`;
    },
    [tab, propertyId],
  );

  const load = useCallback(async () => {
    if (!workspace || !navigator.onLine) return;
    try {
      setPage(await workspace.api.get<InboxPage>(query()));
      setExtra([]);
    } catch {
      // Keep the last list; the next tick tries again.
    }
  }, [workspace, query]);

  useEffect(() => {
    if (!workspace) return;
    workspace.api
      .get<PropertyList>("/properties?limit=100")
      .then((list) => {
        setProperties(list.items.filter((item) => item.status === "active"));
        if (initialProperty && !list.items.some((item) => item.id === initialProperty)) {
          setPropertyId("");
        }
      })
      .catch(() => undefined);
  }, [workspace, initialProperty]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [load]);

  async function more() {
    if (!workspace || !page?.next) return;
    const next = await workspace.api.get<InboxPage>(query(page.next));
    setExtra((current) => [...current, ...next.items]);
    setPage((current) => (current ? { ...current, next: next.next } : current));
  }

  async function dismiss(suggestion: TrustSuggestion) {
    if (!workspace) return;
    await workspace.api.post("/inbox/suggestions/dismiss", {
      propertyId: suggestion.propertyId,
      topic: suggestion.topic,
    });
    await load();
  }

  if (!workspace) return null;
  const items = [...(page?.items ?? []), ...extra];
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  const empty =
    page && page.items.length === 0
      ? !page.hasPublishedGuide
        ? t("noGuide")
        : tab === "needs"
          ? t("caughtUp")
          : tab === "done"
            ? t("emptyDone")
            : t("emptyAll")
      : null;

  return (
    <section aria-labelledby={`${id}-title`} className="inbox">
      <PageHeader
        title={t("title")}
        titleId={`${id}-title`}
        action={
          <Link className="button button-primary with-icon" href={`/${locale}/inbox/copilot`}>
            <Icon data={message} />
            {t("copilot")}
          </Link>
        }
      />
      <AlertsCard compact />
      {!online && (
        <p className="alert alert-info" role="status">
          {t("offline")}
        </p>
      )}
      {page?.suggestions.map((suggestion) => (
        <div className="card suggestion" key={`${suggestion.propertyId}:${suggestion.topic}`}>
          <p>
            {t("suggestion", {
              count: suggestion.count,
              topic: topics.has(suggestion.topic as "other")
                ? topics(suggestion.topic as "other").toLowerCase()
                : suggestion.topic,
              property: suggestion.propertyName,
            })}
          </p>
          <div className="actions">
            <Link
              className="button button-secondary"
              href={
                suggestion.scope === "property"
                  ? `/${locale}/properties/${suggestion.propertyId}/assistant`
                  : `/${locale}/settings/assistant`
              }
            >
              {t("suggestionLink")}
            </Link>
            <button
              type="button"
              className="button button-secondary"
              disabled={!online}
              onClick={() => void dismiss(suggestion)}
            >
              {t("suggestionDismiss")}
            </button>
          </div>
        </div>
      ))}
      <div className="inbox-controls">
        <div role="tablist" aria-label={t("title")} className="tabs">
          {TABS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={`tab ${tab === value ? "tab-active" : ""}`}
              onClick={() => setTab(value)}
            >
              {t(`tabs.${value}`)}
            </button>
          ))}
        </div>
        <label htmlFor={`${id}-property`} className="visually-hidden">
          {t("filter")}
        </label>
        <select
          id={`${id}-property`}
          value={propertyId}
          onChange={(event) => setPropertyId(event.target.value)}
        >
          <option value="">{t("allProperties")}</option>
          {properties.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      {empty ? <EmptyState illustration={inboxClearScene} title={empty} /> : null}
      <ol className="list-plain inbox-list" aria-label={t(`tabs.${tab}`)}>
        {items.map((item) => (
          <li
            key={item.id}
            className={`card inbox-item ${item.reason === "emergency" ? "inbox-urgent" : ""}`}
          >
            <Link
              className="inbox-link"
              href={`/${locale}/properties/${item.propertyId}/conversations/${item.id}`}
            >
              <span className="inbox-title">
                {item.propertyName} ·{" "}
                {item.stay
                  ? t("stay", { checkIn: item.stay.checkInDate, checkout: item.stay.checkoutDate })
                  : t("noStay")}{" "}
                · {t(`channel.${item.channel}`)}
              </span>
              <span className="inbox-meta">
                {item.reason && (
                  <span
                    className={`badge badge-icon ${item.reason === "emergency" ? "badge-danger" : "badge-warning"}`}
                  >
                    <Icon data={reasonIconData(item.reason)} size={16} />
                    {reasons(item.reason)}
                  </span>
                )}
                {item.takenOver && (
                  <span className="badge">
                    {item.takenOverBy
                      ? t("takenOver", { name: item.takenOverBy })
                      : t("takenOverAnon")}
                  </span>
                )}
                <span className="muted">{when(item.lastMessageAt)}</span>
              </span>
              {item.lastMessage && (
                <span className="inbox-excerpt">
                  {t(`author.${item.lastMessage.author}`)}: {item.lastMessage.excerpt}
                </span>
              )}
              {item.replying.length > 0 && (
                <span className="muted">{t("replying", { names: item.replying.join(", ") })}</span>
              )}
            </Link>
          </li>
        ))}
      </ol>
      {page?.next && (
        <button type="button" className="button button-secondary" onClick={() => void more()}>
          {t("more")}
        </button>
      )}
    </section>
  );
}
