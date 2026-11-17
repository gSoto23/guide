"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PropertyDetail, PropertyList, PropertySummary } from "@guidesk/contracts";
import { problemNumber, problemOf } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useWorkspace } from "@/lib/use-workspace";

const DAY_MS = 86_400_000;

/** Days until the permanent deletion, counting a started day; never below zero. */
function daysLeft(purgeAfter: string | null, now: number): number {
  if (!purgeAfter) return 0;
  return Math.max(0, Math.ceil((new Date(purgeAfter).getTime() - now) / DAY_MS));
}

/**
 * Removed properties (US6, FR-045, T119): the days left before each is deleted for good, and
 * "Restore" while the plan has room. Owners and admins only.
 */
export function RemovedProperties({ locale }: { locale: string }) {
  const t = useTranslations("properties");
  const removedText = useTranslations("properties.removed");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const online = useOnline();
  const [items, setItems] = useState<PropertySummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [version, setVersion] = useState(0);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!workspace?.canManage) return;
    const controller = new AbortController();
    workspace.api
      .get<PropertyList>("/properties?status=removed&limit=100", controller.signal)
      .then((list) => setItems(list.items))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [workspace, version]);

  if (!workspace) return <p className="muted">{t("loading")}</p>;
  if (!workspace.canManage) return <p className="muted">{t("start.notAllowed")}</p>;

  async function restore(item: PropertySummary) {
    setBusy(item.id);
    setMessage(null);
    try {
      const restored = await workspace!.api.post<PropertyDetail>(
        `/properties/${encodeURIComponent(item.id)}/restore`,
      );
      setMessage({ kind: "info", text: removedText("restored", { name: restored.name }) });
      setVersion((count) => count + 1);
    } catch (error) {
      const problem = problemOf(error);
      setMessage({
        kind: "error",
        text:
          problem?.code === "plan_limit_reached"
            ? removedText("limitReached", { limit: problemNumber(problem, "limit") ?? 2 })
            : problem?.code === "gone"
              ? removedText("gone")
              : errors(problem?.code === "network" ? "network" : "internal_error"),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <p>
        <Link href={`/${locale}/properties`}>{removedText("back")}</Link>
      </p>
      <h1>{removedText("title")}</h1>
      <p className="muted">{removedText("intro")}</p>
      {message ? (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-info"}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
      {failed ? <p className="alert alert-error">{t("list.loadFailed")}</p> : null}
      {!items && !failed ? <p className="muted">{t("loading")}</p> : null}
      {items && items.length === 0 ? <p className="muted">{removedText("empty")}</p> : null}
      <ul className="property-list">
        {(items ?? []).map((item) => (
          <li key={item.id} className="content-item">
            <div className="content-item-head">
              <h3>{item.name}</h3>
              <span className="badge badge-warning">
                {removedText("daysLeft", { days: daysLeft(item.purgeAfter, now) })}
              </span>
            </div>
            <button
              type="button"
              className="button button-secondary"
              disabled={!online || busy === item.id}
              onClick={() => void restore(item)}
            >
              {busy === item.id ? removedText("restoring") : removedText("restore")}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
