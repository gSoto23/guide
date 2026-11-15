"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { SecurityEventPage, SecurityEventView } from "@guidesk/contracts";
import { apiFetch } from "@/lib/api";
import { useMeContext } from "@/lib/me-context";

type Tab = "workspace" | "mine";

/** Security log viewer (FR-030, T099): the workspace's events and the user's own account events. */
export function SecurityLog({ locale }: { locale: string }) {
  const t = useTranslations("settings.log");
  const context = useMeContext();
  const me = context?.me ?? null;
  const workspaceId = me?.lastWorkspaceId ?? null;
  const role = me?.memberships.find((m) => m.workspaceId === workspaceId)?.role;
  const canSeeWorkspace = role === "owner" || role === "admin";
  const [tab, setTab] = useState<Tab>("workspace");
  const [events, setEvents] = useState<SecurityEventView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  const path =
    tab === "workspace" && workspaceId
      ? `/api/v1/workspaces/${workspaceId}/security-events`
      : "/api/v1/me/security-events";

  const load = useCallback(
    async (after: string | null) => {
      const page = await apiFetch<SecurityEventPage>(
        `${path}?limit=50${after ? `&cursor=${after}` : ""}`,
      );
      setEvents((current) => (after ? [...current, ...page.events] : page.events));
      setCursor(page.nextCursor);
    },
    [path],
  );

  useEffect(() => {
    if (!me) return;
    if (tab === "workspace" && !canSeeWorkspace) {
      setEvents([]);
      setCursor(null);
      return;
    }
    void load(null).catch(() => undefined);
  }, [me, tab, canSeeWorkspace, load]);

  if (!me) return <p className="muted">{t("title")}…</p>;

  return (
    <>
      <h1>{t("title")}</h1>
      <div role="tablist" className="choices">
        {(["workspace", "mine"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={tab === option}
            className={`button ${tab === option ? "button-primary" : "button-secondary"}`}
            onClick={() => setTab(option)}
          >
            {option === "workspace" ? t("workspaceTab") : t("mineTab")}
          </button>
        ))}
      </div>
      {tab === "workspace" && !canSeeWorkspace ? (
        <p className="alert alert-info" role="status">
          {t("noAccess")}
        </p>
      ) : events.length === 0 ? (
        <p className="muted">{t("empty")}</p>
      ) : (
        <ul className="event-list">
          {events.map((event) => (
            <li key={event.id} className="card">
              <strong>{event.type}</strong>
              {event.outcome !== "success" ? ` · ${event.outcome}` : ""}
              <br />
              <span className="muted">
                {new Date(event.occurredAt).toLocaleString(locale)}
                {tab === "workspace"
                  ? ` · ${event.actor ? event.actor.name || event.actor.email : t("unknownActor")}`
                  : ""}
                {event.userAgentFamily ? ` · ${event.userAgentFamily}` : ""}
                {event.approxLocation ? ` · ${event.approxLocation}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {cursor ? (
        <button type="button" className="button button-secondary" onClick={() => void load(cursor)}>
          {t("more")}
        </button>
      ) : null}
    </>
  );
}
