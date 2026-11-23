"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  GuideDocument,
  GuideView,
  ItemText,
  ItemView,
  SectionView,
  SectionWriteResult,
} from "@guidesk/contracts";
import { GuideDocumentView, type RenderableDocument } from "@guidesk/ui";
import { documentHasText, sectionTitle } from "@/lib/guide/labels";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import type { TextItemEditorProps } from "./text-item-editor";

/** Loaded only when the host edits a translation (research R3). */
const TextItemEditor = dynamic<TextItemEditorProps>(() => import("./text-item-editor"), {
  ssr: false,
  loading: () => <div className="guide-editor-content" aria-busy="true" />,
});

const POLL_MS = 5_000;

type Status = "waiting" | "machine" | "reviewed" | "out_of_date" | "failed" | "pending";

function statusOf(text: ItemText | undefined): Status {
  if (!text || text.state === "stale") return "waiting";
  if (text.state === "out_of_date") return "out_of_date";
  if (text.state === "failed") return "failed";
  if (text.state === "pending") return "pending";
  return text.origin === "reviewed" ? "reviewed" : "machine";
}

const BADGE: Record<Status, string> = {
  waiting: "badge",
  machine: "badge badge-warning",
  reviewed: "badge badge-ready",
  out_of_date: "badge badge-warning",
  failed: "badge badge-warning",
  pending: "badge",
};

/**
 * Translations (screen H-19, feature 003 US5): each section side by side, original and
 * translation, with its state (FR-044 to FR-047): waiting, machine, reviewed, out of date, pending
 * with its reason, or failed. The host edits, marks reviewed, translates again, or keeps an
 * out-of-date translation as is.
 */
export function Translations({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("guide");
  const languageNames = useTranslations("properties.facts.languages");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [view, setView] = useState<GuideView | null>(null);
  const [editing, setEditing] = useState<{ itemId: string; doc: GuideDocument | null } | null>(
    null,
  );
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/properties/${propertyId}/guide`;

  const load = useCallback(async () => {
    if (!workspace) return;
    setView(await workspace.api.get<GuideView>(base));
    setConflict(false);
  }, [workspace, base]);

  useEffect(() => {
    void load().catch(() => setError(errors("internal_error")));
  }, [load, errors]);

  // While texts wait for their translation, look again every few seconds (research R7).
  const waiting =
    view?.sections.some((section) =>
      section.items.some((item) => {
        const other = view.languages.find((language) => language !== item.sourceLanguage);
        return other && item.kind !== "fact" && statusOf(item.texts[other]) === "waiting";
      }),
    ) ?? false;
  useEffect(() => {
    if (!waiting || editing) return;
    const timer = setTimeout(() => void load().catch(() => undefined), POLL_MS);
    return () => clearTimeout(timer);
  }, [waiting, editing, view, load]);

  if (!workspace) return null;
  if (!view) return <p className="working">{error ?? t("drafting")}</p>;

  if (view.languages.length < 2) {
    return (
      <section aria-labelledby="translations-title">
        <p>
          <Link className="back-link" href={`/${locale}${base}`}>
            {t("editor.backToGuide")}
          </Link>
        </p>
        <h1 id="translations-title">{t("translations.title")}</h1>
        <p className="alert alert-info">
          {t("translations.singleLanguage")}{" "}
          <Link href={`/${locale}/properties/${propertyId}`}>{t("translations.openProperty")}</Link>
        </p>
      </section>
    );
  }

  const labelFor = (fieldId: string) =>
    view.lockedFields.find((field) => field.id === fieldId)?.label ?? t("editor.lockedField");

  function replaceSection(section: SectionView) {
    setView((current) =>
      current
        ? {
            ...current,
            sections: current.sections.map((candidate) =>
              candidate.id === section.id ? section : candidate,
            ),
          }
        : current,
    );
  }

  async function write(run: () => Promise<SectionWriteResult>) {
    setError(null);
    try {
      const result = await run();
      replaceSection(result.section);
      return true;
    } catch (caught) {
      const code = problemOf(caught)?.code ?? "internal_error";
      if (code === "section_changed") setConflict(true);
      else setError(errors.has(code) ? errors(code) : errors("internal_error"));
      return false;
    }
  }

  function action(section: SectionView, item: ItemView, language: string, name: string) {
    return write(() =>
      workspace!.api.post<SectionWriteResult>(`${base}/items/${item.id}/translations/${language}`, {
        revision: section.revision,
        action: name,
      }),
    );
  }

  async function save(section: SectionView, item: ItemView, language: string) {
    if (!editing?.doc) return;
    const doc = editing.doc;
    const saved = await write(() =>
      workspace!.api.patch<SectionWriteResult>(`${base}/items/${item.id}`, {
        revision: section.revision,
        language,
        doc,
      }),
    );
    if (saved) setEditing(null);
  }

  return (
    <section aria-labelledby="translations-title">
      <p>
        <Link className="back-link" href={`/${locale}${base}`}>
          {t("editor.backToGuide")}
        </Link>
      </p>
      <h1 id="translations-title">{t("translations.title")}</h1>
      <p className="muted">{t("translations.intro")}</p>
      {conflict && (
        <div className="alert alert-error" role="alert">
          {t("translations.changed")}{" "}
          <button type="button" className="button button-secondary" onClick={() => void load()}>
            {t("translations.reload")}
          </button>
        </div>
      )}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {view.sections
        .filter((section) => !section.hidden)
        .map((section) => {
          const items = section.items.filter(
            (item) => item.kind !== "fact" && item.sharedBlockId === null,
          );
          return (
            <section key={section.id} className="card" aria-labelledby={`tr-${section.id}`}>
              <h2 id={`tr-${section.id}`}>{sectionTitle(t, section, locale)}</h2>
              {items.length === 0 && <p className="muted">{t("translations.empty")}</p>}
              {items.map((item) => {
                const source = item.texts[item.sourceLanguage];
                const language = view.languages.find((entry) => entry !== item.sourceLanguage)!;
                const text = item.texts[language];
                const status = statusOf(text);
                const isEditing = editing?.itemId === item.id;
                if (!documentHasText(source?.doc)) return null;
                return (
                  <div key={item.id} className="translation-row" data-item={item.id}>
                    <div lang={item.sourceLanguage}>
                      <p className="muted">
                        {t("translations.source", { language: languageNames(item.sourceLanguage) })}
                      </p>
                      <GuideDocumentView
                        doc={source?.doc as RenderableDocument | null}
                        renderLockedField={(id) => `🔒 ${labelFor(id)}`}
                      />
                    </div>
                    <div lang={language}>
                      <p className="muted">
                        {t("translations.translation", { language: languageNames(language) })}{" "}
                        <span className={BADGE[status]}>{t(`translations.state_${status}`)}</span>
                        {status === "pending" && text?.pendingReason && (
                          <span className="muted">
                            {" "}
                            · {t(`translations.reason_${text.pendingReason}`)}
                          </span>
                        )}
                      </p>
                      {isEditing ? (
                        <>
                          <TextItemEditor
                            doc={editing.doc}
                            labelFor={labelFor}
                            onChange={(doc) => setEditing({ itemId: item.id, doc })}
                            ariaLabel={t("translations.translation", {
                              language: languageNames(language),
                            })}
                          />
                          <div className="actions">
                            <button
                              type="button"
                              className="button button-primary"
                              onClick={() => void save(section, item, language)}
                            >
                              {t("translations.save")}
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => setEditing(null)}
                            >
                              {t("translations.cancel")}
                            </button>
                          </div>
                        </>
                      ) : (
                        text?.doc && (
                          <GuideDocumentView
                            doc={text.doc as RenderableDocument}
                            renderLockedField={(id) => `🔒 ${labelFor(id)}`}
                          />
                        )
                      )}
                      {view.canEdit && !isEditing && (
                        <div className="actions">
                          {text?.doc && (
                            <button
                              type="button"
                              className="button-link"
                              onClick={() =>
                                setEditing({ itemId: item.id, doc: text.doc as GuideDocument })
                              }
                            >
                              {t("translations.edit")}
                            </button>
                          )}
                          {status === "machine" && (
                            <button
                              type="button"
                              className="button-link"
                              onClick={() => void action(section, item, language, "mark_reviewed")}
                            >
                              {t("translations.markReviewed")}
                            </button>
                          )}
                          {status === "out_of_date" && (
                            <button
                              type="button"
                              className="button-link"
                              onClick={() => void action(section, item, language, "keep")}
                            >
                              {t("translations.keep")}
                            </button>
                          )}
                          {(status === "out_of_date" ||
                            status === "failed" ||
                            status === "reviewed" ||
                            status === "pending") && (
                            <button
                              type="button"
                              className="button-link"
                              onClick={() =>
                                void action(section, item, language, "translate_again")
                              }
                            >
                              {t("translations.translateAgain")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          );
        })}
    </section>
  );
}
