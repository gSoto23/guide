"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { ExploreCategory, PropertyExplore } from "@guidesk/contracts";
import { EXPLORE_CATEGORY_VALUES } from "@guidesk/contracts/values";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

interface Draft {
  followsDefault: boolean;
  experiencesEnabled: boolean;
  hiddenCategories: ExploreCategory[];
  hiddenExperiences: string[];
}

const draftOf = (data: PropertyExplore): Draft => ({
  followsDefault: data.followsDefault,
  experiencesEnabled: data.own.experiencesEnabled,
  hiddenCategories: data.own.hiddenCategories,
  hiddenExperiences: data.hiddenExperiences,
});

/**
 * A property's Explore settings (feature 009 US2, screen H-28): follow the workspace default or set
 * its own, hide categories and single experiences, see the host's tips, and preview what guests see.
 * Changes reach guests within a minute, without republishing (FR-025).
 */
export function PropertyExploreSettings({
  locale,
  propertyId,
}: {
  locale: string;
  propertyId: string;
}) {
  const t = useTranslations("explore");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const id = useId();
  const [data, setData] = useState<PropertyExplore | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const lang = locale === "en" ? "en" : "es";

  const load = useCallback(async () => {
    if (!workspace) return;
    const loaded = await workspace.api.get<PropertyExplore>(
      `/properties/${propertyId}/explore?lang=${lang}`,
    );
    setData(loaded);
    setDraft(draftOf(loaded));
  }, [workspace, propertyId, lang]);

  useEffect(() => {
    void load().catch(() => setMessage({ kind: "error", text: errors("internal_error") }));
  }, [load, errors]);

  if (!workspace || !data || !draft) return null;
  const editable = workspace.canManage && !busy;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !data || !draft) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await workspace.api.put<PropertyExplore>(
        `/properties/${propertyId}/explore?lang=${lang}`,
        {
          version: data.version,
          followsDefault: draft.followsDefault,
          own: {
            experiencesEnabled: draft.experiencesEnabled,
            hiddenCategories: draft.hiddenCategories,
          },
          hiddenExperiences: draft.hiddenExperiences,
        },
      );
      setData(saved);
      setDraft(draftOf(saved));
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

  const toggleCategory = (category: ExploreCategory, shown: boolean) =>
    setDraft({
      ...draft,
      hiddenCategories: shown
        ? draft.hiddenCategories.filter((value) => value !== category)
        : [...draft.hiddenCategories, category],
    });
  const toggleExperience = (ref: string, hidden: boolean) =>
    setDraft({
      ...draft,
      hiddenExperiences: hidden
        ? [...draft.hiddenExperiences, ref]
        : draft.hiddenExperiences.filter((value) => value !== ref),
    });

  const preview = data.experiences.filter((item) => item.shown);
  return (
    <section aria-labelledby={`${id}-title`} className="explore-settings">
      <h1 id={`${id}-title`}>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>
      {!workspace.canManage && <p className="muted">{t("readOnly")}</p>}
      <form className="card" onSubmit={(event) => void save(event)}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.followsDefault}
            disabled={!editable}
            onChange={(event) => setDraft({ ...draft, followsDefault: event.target.checked })}
          />
          {t("follow")}
        </label>
        <p className="field-hint">
          {t("followHint", {
            state: data.effective.experiencesEnabled ? t("stateOn") : t("stateOff"),
          })}
        </p>
        {!draft.followsDefault && (
          <>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.experiencesEnabled}
                disabled={!editable}
                onChange={(event) =>
                  setDraft({ ...draft, experiencesEnabled: event.target.checked })
                }
              />
              {t("enabled")}
            </label>
            <fieldset className="choices" disabled={!editable || !draft.experiencesEnabled}>
              <legend>{t("categoriesLegend")}</legend>
              {EXPLORE_CATEGORY_VALUES.map((category) => (
                <label key={category} className="checkbox">
                  <input
                    type="checkbox"
                    checked={!draft.hiddenCategories.includes(category)}
                    onChange={(event) => toggleCategory(category, event.target.checked)}
                  />
                  {t(`categories.${category}`)}
                </label>
              ))}
            </fieldset>
          </>
        )}
        <h2>
          {data.destination.city
            ? t("experiencesTitle", { city: data.destination.city })
            : t("experiencesNoCity")}
        </h2>
        {!data.destination.city ? (
          <p className="muted">{t("noDestination")}</p>
        ) : data.experiences.length === 0 ? (
          <p className="muted">{t("noExperiences")}</p>
        ) : (
          <ul className="list-plain explore-list">
            {data.experiences.map((item) => (
              <li key={item.ref} className="explore-row">
                <span>
                  <strong>{item.title}</strong>{" "}
                  <span className="muted">
                    · {t(`categories.${item.category}`)} ·{" "}
                    {t("partner", { partner: item.partnerName })}
                  </span>
                </span>
                <span className="explore-row-actions">
                  <span className={`badge ${item.shown ? "badge-ready" : ""}`}>
                    {item.categoryHidden
                      ? t("hiddenCategory")
                      : item.shown
                        ? t("shown")
                        : t("notShown")}
                  </span>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={draft.hiddenExperiences.includes(item.ref)}
                      disabled={!editable}
                      onChange={(event) => toggleExperience(item.ref, event.target.checked)}
                    />
                    {t("hide")}
                    <span className="visually-hidden"> {item.title}</span>
                  </label>
                </span>
              </li>
            ))}
          </ul>
        )}
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
      <section className="card" aria-labelledby={`${id}-preview`}>
        <h2 id={`${id}-preview`}>{t("previewTitle")}</h2>
        {!data.visible ? (
          <p className="muted">{t("previewEmpty")}</p>
        ) : (
          <>
            <h3>{t("tipsTitle")}</h3>
            {data.tips.length === 0 ? (
              <p className="muted">{t("tipsEmpty")}</p>
            ) : (
              <ul>
                {data.tips.map((tip, index) => (
                  <li key={`${tip.name}-${index}`}>{tip.name}</li>
                ))}
              </ul>
            )}
            {preview.length > 0 && (
              <>
                <p className="muted">{t("disclosure")}</p>
                <ol>
                  {preview.map((item) => (
                    <li key={item.ref}>
                      {item.title}{" "}
                      <span className="muted">· {t(`categories.${item.category}`)}</span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        )}
      </section>
    </section>
  );
}
