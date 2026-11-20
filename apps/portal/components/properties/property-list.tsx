"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  ConfirmPropertiesResult,
  PropertyLimits,
  PropertyList,
  PropertySummary,
} from "@guidesk/contracts";
import { house, Icon, plus } from "@guidesk/ui";
import { PageHeader } from "@/components/shell/page-header";
import { useWorkspace } from "@/lib/use-workspace";
import { StartOptionsPanel } from "./start-options";

/**
 * The property list (FR-006, T045): name, setup status, source, calendar status, and search by
 * name. With no properties yet, it shows the starting options instead.
 */
export function PropertyListView({ locale }: { locale: string }) {
  const t = useTranslations("properties");
  const plan = useTranslations("plan");
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<PropertySummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [limits, setLimits] = useState<PropertyLimits | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    const params = new URLSearchParams(search ? { query: search } : {});
    setFailed(false);
    Promise.all([
      workspace.api.get<PropertyList>(`/properties?${params.toString()}`, controller.signal),
      workspace.api.get<PropertyLimits>("/properties/limits", controller.signal),
    ])
      .then(([list, usage]) => {
        setItems(list.items);
        setCursor(list.nextCursor);
        setLimits(usage);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [workspace, search, version]);

  async function loadMore() {
    if (!workspace || !cursor) return;
    const params = new URLSearchParams({ cursor, ...(search ? { query: search } : {}) });
    const next = await workspace.api.get<PropertyList>(`/properties?${params.toString()}`);
    setItems([...(items ?? []), ...next.items]);
    setCursor(next.nextCursor);
  }

  if (!workspace) return <p className="muted">{t("loading")}</p>;
  if (failed) return <p className="alert alert-error">{t("list.loadFailed")}</p>;
  if (!items || !limits) return <p className="muted">{t("loading")}</p>;

  if (items.length === 0 && !search) {
    return (
      <>
        <StartOptionsPanel locale={locale} title={t("firstTitle")} />
        {workspace.canManage ? (
          <p>
            <Link href={`/${locale}/properties?view=removed`}>{t("removed.show")}</Link>
          </p>
        ) : null}
      </>
    );
  }

  // "Confirm all" (FR-004): imported properties whose facts are complete become ready.
  const toConfirm = items.filter((item) => item.setupStatus === "to_confirm");
  async function confirmAll() {
    if (!workspace || toConfirm.length === 0) return;
    setConfirming(true);
    setNotice(null);
    try {
      const result = await workspace.api.post<ConfirmPropertiesResult>("/properties/confirm", {
        propertyIds: toConfirm.map((item) => item.id),
      });
      setNotice(t("list.confirmed", { count: result.ready.length }));
      setVersion((count) => count + 1);
    } catch {
      setNotice(t("list.loadFailed"));
    } finally {
      setConfirming(false);
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(query.trim());
  };

  return (
    <>
      <PageHeader
        title={t("list.title")}
        help={
          limits.limit === null
            ? t("limits.usageUnlimited", { used: limits.used })
            : t("limits.usage", { used: limits.used, limit: limits.limit })
        }
        action={
          workspace.canManage && (limits.limit === null || limits.used < limits.limit) ? (
            <Link className="button button-primary with-icon" href={`/${locale}/properties/new`}>
              <Icon data={plus} />
              {t("list.add")}
            </Link>
          ) : undefined
        }
      />
      {workspace.canManage && limits.limit !== null && limits.used >= limits.limit ? (
        <p className="alert alert-info" role="status">
          {t("limits.reached", { limit: limits.limit })}{" "}
          <Link href={`/${locale}/settings/plan`}>{plan("link")}</Link>
        </p>
      ) : null}
      {workspace.canManage && toConfirm.length > 0 ? (
        <div className="card">
          <p>{t("list.toConfirm", { count: toConfirm.length })}</p>
          <button
            type="button"
            className="button button-primary"
            disabled={confirming}
            onClick={() => void confirmAll()}
          >
            {t("list.confirmAll")}
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="alert alert-info" role="status">
          {notice}
        </p>
      ) : null}
      <form role="search" onSubmit={submit}>
        <label>
          {t("list.searchLabel")}
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </form>
      {items.length === 0 ? (
        <p className="muted">{t("list.noMatches", { query: search })}</p>
      ) : null}
      <ul className="property-list card-grid">
        {items.map((item) => (
          <li key={item.id}>
            <Link className="property-row" href={`/${locale}/properties/${item.id}`}>
              {item.cover ? (
                <img
                  className="property-thumb"
                  src={item.cover.smallUrl ?? item.cover.url}
                  alt=""
                  width={640}
                  height={360}
                  loading="lazy"
                />
              ) : (
                <span className="property-thumb property-thumb-empty" aria-hidden="true">
                  <Icon data={house} size={28} />
                </span>
              )}
              <strong>{item.name}</strong>
              <span className="property-meta">
                <span
                  className={`badge ${item.setupStatus === "ready" ? "badge-ready" : "badge-warning"}`}
                >
                  {t(`setupStatus.${item.setupStatus}`)}
                </span>
                <span className="badge">
                  {t(`source.${item.source}`, {
                    provider: item.sourceProvider ? t(`providers.${item.sourceProvider}`) : "",
                  })}
                </span>
                <span className="badge">{t(`list.calendar.${item.calendarStatus}`)}</span>
                {item.guide ? (
                  <span
                    className={`badge ${item.guide.status === "published" ? "badge-ready" : ""}`}
                  >
                    {t(
                      `list.guide.${item.guide.status === "published" && item.guide.hasUnpublishedChanges ? "published_changes" : item.guide.status}`,
                      { score: item.guide.completeness },
                    )}
                  </span>
                ) : null}
                {item.pmsStatus === "not_found" ? (
                  <span className="badge badge-warning">{t("list.notFoundInPms")}</span>
                ) : null}
              </span>
              {item.setupStatus === "needs_details" && item.missingFacts.length > 0 ? (
                <span className="muted property-missing">
                  {t("detail.missing", {
                    facts: item.missingFacts.map((fact) => t(`factNames.${fact}`)).join(", "),
                  })}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
      {cursor ? (
        <button type="button" className="button button-secondary" onClick={() => void loadMore()}>
          {t("list.loadMore")}
        </button>
      ) : null}
      {workspace.canManage ? (
        <p>
          <Link href={`/${locale}/properties?view=removed`}>{t("removed.show")}</Link>
        </p>
      ) : null}
    </>
  );
}
