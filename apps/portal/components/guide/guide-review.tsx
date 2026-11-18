"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { GuideView, SectionWriteResult } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { guideStatusKey, sectionTitle } from "@/lib/guide/labels";
import { useWorkspace } from "@/lib/use-workspace";

const STATUS_BADGE: Record<string, string> = {
  missing: "badge",
  needs_review: "badge badge-warning",
  ready: "badge badge-ready",
};

/**
 * The guide draft review (screen H-12, feature 003 US1): completeness and the missing topics guests
 * ask about most (FR-030, FR-033), the sections with their status and size (FR-013), and links to
 * each section's editor. Agents read only (FR-063).
 */
export function GuideReview({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [view, setView] = useState<GuideView | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      workspace.api
        .get<GuideView>(`/properties/${propertyId}/guide`, controller.signal)
        .then((loaded) => {
          setView(loaded);
          // While the draft is being prepared, look again every few seconds (research R16).
          if (loaded.draftState === "drafting") timer = setTimeout(load, 3000);
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        });
    void load();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [workspace, propertyId]);

  if (!workspace) return null;
  if (failed) return <p className="alert alert-error">{errors("internal_error")}</p>;
  if (!view) return <p className="working">{t("drafting")}</p>;

  const base = `/${locale}/properties/${propertyId}/guide`;
  const statusKey = guideStatusKey(view.status, view.hasUnpublishedChanges);

  async function addSection(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !title.trim()) return;
    setError(null);
    try {
      const result = await workspace.api.post<SectionWriteResult>(
        `/properties/${propertyId}/guide/sections`,
        { title: { [locale === "en" ? "en" : "es"]: title.trim() } },
        { idempotent: true },
      );
      setView((current) =>
        current ? { ...current, sections: [...current.sections, result.section] } : current,
      );
      setAdding(false);
      setTitle("");
    } catch (caught) {
      const code = problemOf(caught)?.code;
      setError(errors(code === "section_limit" ? "section_limit" : "internal_error"));
    }
  }

  return (
    <section aria-labelledby="guide-title">
      <p>
        <Link href={`/${locale}/properties/${propertyId}`}>{t("review.backToProperty")}</Link>
      </p>
      <h1 id="guide-title">{t("review.title", { name: view.propertyName })}</h1>
      <p>
        <span className="badge">{t(`guideStatus.${statusKey}`)}</span>{" "}
        <strong>{t("review.completeness", { score: view.completeness })}</strong>
      </p>
      {!view.canEdit && <p className="alert alert-info">{t("review.readOnly")}</p>}
      {view.draftState === "drafting" && <p className="working">{t("drafting")}</p>}
      {view.draftState === "failed" && view.canEdit && (
        <p className="alert alert-info">{t("review.draftFailed")}</p>
      )}
      {!view.setupReady && view.canEdit && (
        <p className="alert alert-info">{t("review.notReady")}</p>
      )}

      <div className="card" aria-labelledby="missing-title">
        <h2 id="missing-title">{t("review.completenessHint")}</h2>
        {view.missingTopics.length === 0 ? (
          <p>{t("review.noMissing")}</p>
        ) : (
          <ul className="issue-list">
            {view.missingTopics.slice(0, 5).map((topic) => {
              const section = view.sections.find(
                (candidate) => candidate.kind === topic.sectionKind,
              );
              return (
                <li key={topic.topicId}>
                  <span>{t(`topics.${topic.topicId}.name`)}</span>
                  {section && view.canEdit && (
                    <Link className="button-link" href={`${base}/sections/${section.id}`}>
                      {t("review.editSection")}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ol className="property-list" aria-label={t("title")}>
        {view.sections.map((section) => {
          const count = section.items.filter((item) => item.kind !== "fact").length;
          return (
            <li key={section.id} className="property-row">
              <Link href={`${base}/sections/${section.id}`}>
                <strong>{sectionTitle(t, section, locale)}</strong>
              </Link>
              <span className="property-meta">
                {section.hidden ? (
                  <span className="badge">{t("review.hidden")}</span>
                ) : (
                  <span className={STATUS_BADGE[section.status]}>
                    {t(`status.${section.status}`)}
                  </span>
                )}{" "}
                {t("review.items", { count })}
                {section.completeness !== null && ` · ${section.completeness} %`}
              </span>
            </li>
          );
        })}
      </ol>

      {view.canEdit &&
        (adding ? (
          <form onSubmit={addSection} className="card">
            <label htmlFor="new-section-title">{t("review.sectionTitle")}</label>
            <input
              id="new-section-title"
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
            {error && <p className="field-error">{error}</p>}
            <div className="actions">
              <button type="submit" className="button button-primary">
                {t("review.create")}
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setAdding(false)}
              >
                {t("review.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="button button-secondary" onClick={() => setAdding(true)}>
            {t("review.addSection")}
          </button>
        ))}
    </section>
  );
}
