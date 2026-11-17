"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { PropertyLimits, PropertyList, PropertySummary } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";
import { StartOptionsPanel } from "./start-options";

/**
 * The property list (FR-006, T045): name, setup status, source, calendar status, and search by
 * name. With no properties yet, it shows the starting options instead.
 */
export function PropertyListView({ locale }: { locale: string }) {
  const t = useTranslations("properties");
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<PropertySummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [limits, setLimits] = useState<PropertyLimits | null>(null);
  const [failed, setFailed] = useState(false);

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
  }, [workspace, search]);

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
    return <StartOptionsPanel locale={locale} title={t("firstTitle")} />;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSearch(query.trim());
  };

  return (
    <>
      <h1>{t("list.title")}</h1>
      <p className="muted">{t("limits.usage", { used: limits.used, limit: limits.limit })}</p>
      {workspace.canManage ? (
        limits.used < limits.limit ? (
          <Link className="button button-primary" href={`/${locale}/properties/new`}>
            {t("list.add")}
          </Link>
        ) : (
          <p className="alert alert-info" role="status">
            {t("limits.reached", { limit: limits.limit })}
          </p>
        )
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
      <ul className="property-list">
        {items.map((item) => (
          <li key={item.id}>
            <Link className="property-row" href={`/${locale}/properties/${item.id}`}>
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
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {cursor ? (
        <button type="button" className="button button-secondary" onClick={() => void loadMore()}>
          {t("list.loadMore")}
        </button>
      ) : null}
    </>
  );
}
