"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { ExploreCategory, WorkspaceExplore } from "@guidesk/contracts";
import { EXPLORE_CATEGORY_VALUES } from "@guidesk/contracts/values";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

/** The workspace default for Explore (feature 009 FR-021): experiences on or off, categories. */
export function WorkspaceExploreSettings() {
  const t = useTranslations("explore");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const id = useId();
  const [data, setData] = useState<WorkspaceExplore | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    setData(await workspace.api.get<WorkspaceExplore>("/explore"));
  }, [workspace]);

  useEffect(() => {
    void load().catch(() => setMessage({ kind: "error", text: errors("internal_error") }));
  }, [load, errors]);

  if (!workspace || !data) return null;
  const editable = workspace.canManage && !busy;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !data) return;
    setBusy(true);
    setMessage(null);
    try {
      setData(await workspace.api.put<WorkspaceExplore>("/explore", data));
      setMessage({ kind: "success", text: t("saved") });
    } catch (cause) {
      if (problemOf(cause)?.code === "settings_changed") {
        await load();
        setMessage({ kind: "error", text: t("changed") });
      } else {
        setMessage({ kind: "error", text: errors("internal_error") });
      }
    } finally {
      setBusy(false);
    }
  }

  const toggle = (category: ExploreCategory, shown: boolean) =>
    setData({
      ...data,
      hiddenCategories: shown
        ? data.hiddenCategories.filter((value) => value !== category)
        : [...data.hiddenCategories, category],
    });

  return (
    <section aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`}>{t("workspaceTitle")}</h1>
      <p className="muted">{t("workspaceIntro")}</p>
      <p className="muted">{t("intro")}</p>
      {!workspace.canManage && <p className="muted">{t("readOnly")}</p>}
      <form className="card" onSubmit={(event) => void save(event)}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={data.experiencesEnabled}
            disabled={!editable}
            onChange={(event) => setData({ ...data, experiencesEnabled: event.target.checked })}
          />
          {t("enabled")}
        </label>
        <fieldset className="choices" disabled={!editable || !data.experiencesEnabled}>
          <legend>{t("categoriesLegend")}</legend>
          {EXPLORE_CATEGORY_VALUES.map((category) => (
            <label key={category} className="checkbox">
              <input
                type="checkbox"
                checked={!data.hiddenCategories.includes(category)}
                onChange={(event) => toggle(category, event.target.checked)}
              />
              {t(`categories.${category}`)}
            </label>
          ))}
        </fieldset>
        {workspace.canManage && (
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={!editable}>
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        )}
        <div aria-live="polite">
          {message && (
            <p
              className={`alert ${message.kind === "error" ? "alert-error" : "alert-success"}`}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {message.text}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
