"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  GuideDocument,
  GuideView,
  ItemView,
  MediaView,
  Recommendation,
  SectionView,
  SectionWriteResult,
} from "@guidesk/contracts";
import { createWriteQueue } from "@/lib/guide/autosave";
import { sectionTitle } from "@/lib/guide/labels";
import { problemOf } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useStepUp } from "@/lib/use-step-up";
import { useWorkspace } from "@/lib/use-workspace";
import { ItemCard, type ItemActions } from "./item-card";
import { MediaUploadButton } from "./media-upload";

/** Sections where a photo answers guests' questions better than text (feature 016 FR-011). */
const PHOTO_PROMPT_KINDS = ["arrival", "parking", "wifi", "appliances", "checkout"] as const;

// Opened only when adding or editing a recommendation (Performance Budget, 150 KB per route).
const RecommendationForm = dynamic(
  () => import("./recommendation-form").then((m) => m.RecommendationForm),
  { ssr: false },
);

/** Loaded only in sections the workspace shares content into (US7). */
const SharedBlocksPanel = dynamic(() => import("./shared-blocks-panel"), { ssr: false });

/** Thrown inside a write when the host closes the step-up dialog; not an error to show. */
const CANCELLED = Symbol("cancelled");

/**
 * The section editor (screen H-13, feature 003 US1): items with text, images, videos,
 * recommendations, and live facts; approval (FR-005); order; hiding default sections and renaming
 * or deleting custom ones (FR-002). Every write carries the section's revision and runs one at a
 * time; a conflict shows a reload notice and keeps the host's text on the device (FR-012).
 */
export function SectionEditor({
  locale,
  propertyId,
  sectionId,
}: {
  locale: string;
  propertyId: string;
  sectionId: string;
}) {
  const t = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const online = useOnline();
  const { run: withStepUp, dialog } = useStepUp();
  const enqueue = useMemo(() => createWriteQueue(), []);
  const [view, setView] = useState<GuideView | null>(null);
  const [section, setSection] = useState<SectionView | null>(null);
  const [failed, setFailed] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingRecommendation, setAddingRecommendation] = useState(false);
  /** The latest revision the editor knows, read by queued writes (FR-012). */
  const revisionRef = useRef(0);
  const language: "es" | "en" = view?.mainLanguage ?? (locale === "en" ? "en" : "es");

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      const loaded = await workspace.api.get<GuideView>(`/properties/${propertyId}/guide`);
      setView(loaded);
      const found = loaded.sections.find((candidate) => candidate.id === sectionId) ?? null;
      revisionRef.current = found?.revision ?? 0;
      setSection(found);
      setConflict(false);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [workspace, propertyId, sectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const base = `/properties/${propertyId}/guide`;

  /** Runs one section write with the latest revision; updates the section from the answer. */
  const write = useCallback(
    async (
      run: (revision: number) => Promise<SectionWriteResult>,
    ): Promise<SectionWriteResult | null> => {
      setError(null);
      try {
        const result = await enqueue(async () => {
          const answer = await run(revisionRef.current);
          revisionRef.current = answer.section.revision;
          return answer;
        });
        setSection(result.section);
        return result;
      } catch (caught) {
        if (caught === CANCELLED) return null;
        const code = problemOf(caught)?.code ?? "internal_error";
        if (code === "section_changed") setConflict(true);
        else setError(errors.has(code) ? errors(code) : errors("internal_error"));
        throw caught;
      }
    },
    [enqueue, errors],
  );

  const actions: ItemActions = useMemo(
    () => ({
      save: async (item, body) => {
        const result = await write((revision) =>
          workspace!.api.patch<SectionWriteResult>(`${base}/items/${item.id}`, {
            revision,
            language,
            ...body,
          }),
        );
        return result?.warnings ?? [];
      },
      approve: async (item) => {
        await write((revision) =>
          workspace!.api.post<SectionWriteResult>(`${base}/items/${item.id}/approve`, { revision }),
        );
      },
      moveToLocked: async (item, warning) => {
        const result = await write(async (revision) => {
          const answer = await withStepUp(() =>
            workspace!.api.post<SectionWriteResult>(
              `${base}/items/${item.id}/move-to-locked-field`,
              {
                revision,
                language: warning.language,
                blockIndex: warning.blockIndex,
                kind: warning.kind,
              },
            ),
          );
          if (!answer) throw CANCELLED;
          return answer;
        }).catch(() => null);
        if (!result) return false;
        // The new locked field joins the guide's list, so its label shows in the item.
        await load();
        return true;
      },
      remove: async (item) => {
        await write((revision) =>
          workspace!.api.delete<SectionWriteResult>(`${base}/items/${item.id}`, { revision }),
        );
      },
      move: async (item, direction) => {
        await write((revision) => {
          const own = (section?.items ?? [])
            .filter((candidate) => candidate.sharedBlockId === null)
            .map((candidate) => candidate.id);
          const index = own.indexOf(item.id);
          const target = index + direction;
          if (index < 0 || target < 0 || target >= own.length)
            return Promise.reject(new Error("out of range"));
          [own[index], own[target]] = [own[target]!, own[index]!];
          return workspace!.api.put<SectionWriteResult>(
            `${base}/sections/${sectionId}/items/order`,
            { revision, itemIds: own },
          );
        });
      },
    }),
    [write, workspace, base, language, section, sectionId, withStepUp, load],
  );

  if (!workspace) return null;
  if (failed) return <p className="alert alert-error">{errors("internal_error")}</p>;
  if (!view || !section) return <p className="working">{t("drafting")}</p>;

  const canEdit = view.canEdit;
  const title = sectionTitle(t, section, locale);
  const own = section.items.filter((item) => item.sharedBlockId === null);

  async function addText() {
    await write((revision) =>
      workspace!.api.post<SectionWriteResult>(
        `${base}/sections/${sectionId}/items`,
        { revision, kind: "text", language, doc: { type: "doc", content: [] } },
        { idempotent: true },
      ),
    ).catch(() => undefined);
  }

  async function addMedia(media: MediaView) {
    await write((revision) =>
      workspace!.api.post<SectionWriteResult>(
        `${base}/sections/${sectionId}/items`,
        { revision, kind: media.kind, language, mediaId: media.id },
        { idempotent: true },
      ),
    ).catch(() => undefined);
  }

  async function addRecommendation(recommendation: Recommendation, tip: string) {
    const doc: GuideDocument = tip
      ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: tip }] }] }
      : { type: "doc", content: [] };
    await write((revision) =>
      workspace!.api.post<SectionWriteResult>(
        `${base}/sections/${sectionId}/items`,
        { revision, kind: "recommendation", language, recommendation, doc },
        { idempotent: true },
      ),
    );
    setAddingRecommendation(false);
  }

  return (
    <section aria-labelledby="section-title">
      {dialog}
      <p>
        <Link href={`/${locale}${base}`}>{t("editor.backToGuide")}</Link>
      </p>
      <h1 id="section-title">{title}</h1>
      <p className="muted">
        {t(`status.${section.status}`)}
        {section.completeness !== null && ` · ${section.completeness} %`}
      </p>
      {section.hidden && <p className="alert alert-info">{t("editor.hiddenNotice")}</p>}
      {view.sharedBlocks.some((block) => block.sectionKind === section.kind) && (
        <SharedBlocksPanel
          view={view}
          section={section}
          propertyId={propertyId}
          onChanged={async (result) => {
            setSection(result.section);
            revisionRef.current = result.section.revision;
            await load();
          }}
        />
      )}
      {conflict && (
        <div className="alert alert-error" role="alert">
          {t("editor.conflict")}{" "}
          <button type="button" className="button button-secondary" onClick={() => void load()}>
            {t("editor.reload")}
          </button>
        </div>
      )}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="alert alert-info">{notice}</p>}
      {!online && canEdit && <p className="alert alert-info">{t("editor.offline")}</p>}
      {canEdit && <p className="field-hint">{t("keepCodesOut")}</p>}

      {section.items.length === 0 ? (
        <p>{t("editor.empty")}</p>
      ) : (
        <ul className="content-list" aria-label={title}>
          {section.items.map((item: ItemView) => (
            <ItemCard
              key={item.id}
              item={item}
              view={view}
              language={language}
              canEdit={canEdit}
              first={own[0]?.id === item.id}
              last={own.at(-1)?.id === item.id}
              locale={locale}
              propertyId={propertyId}
              actions={actions}
            />
          ))}
        </ul>
      )}

      {canEdit &&
        PHOTO_PROMPT_KINDS.includes(section.kind as (typeof PHOTO_PROMPT_KINDS)[number]) &&
        !section.items.some((item) => item.kind === "image") && (
          // Feature 016 FR-011: suggest the photo that answers questions best in this section.
          <p className="photo-prompt" role="note">
            {/* The camera icon is drawn in CSS: this route is near its JavaScript budget. */}
            <span className="section-icon photo-prompt-icon" aria-hidden="true" />
            <span>{t(`photoPrompt.${section.kind}`)}</span>
          </p>
        )}

      {canEdit && (
        <>
          <div className="actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void addText()}
              disabled={!online}
            >
              {t("editor.addText")}
            </button>
            <MediaUploadButton
              propertyId={propertyId}
              kind="image"
              label={t("editor.addPhoto")}
              onReady={addMedia}
              disabled={!online}
            />
            <MediaUploadButton
              propertyId={propertyId}
              kind="video"
              label={t("editor.addVideo")}
              onReady={addMedia}
              disabled={!online}
            />
            {section.kind === "local_recommendations" && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setAddingRecommendation(true)}
                disabled={!online}
              >
                {t("editor.addRecommendation")}
              </button>
            )}
          </div>
          {addingRecommendation && (
            <RecommendationForm
              onSave={addRecommendation}
              onCancel={() => setAddingRecommendation(false)}
            />
          )}

          <div className="actions">
            {section.items.some((item) => !item.reviewed) && (
              <button
                type="button"
                className="button button-primary"
                onClick={() =>
                  void write((revision) =>
                    workspace.api.post<SectionWriteResult>(
                      `${base}/sections/${sectionId}/approve`,
                      { revision },
                    ),
                  ).catch(() => undefined)
                }
              >
                {t("editor.approveAll")}
              </button>
            )}
            {section.kind !== "custom" && (
              <>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() =>
                    void write((revision) =>
                      workspace.api.patch<SectionWriteResult>(`${base}/sections/${sectionId}`, {
                        revision,
                        hidden: !section.hidden,
                      }),
                    ).catch(() => undefined)
                  }
                >
                  {section.hidden ? t("editor.show") : t("editor.hide")}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={async () => {
                    try {
                      await workspace.api.post(`${base}/sections/${sectionId}/redraft`);
                      setNotice(t("editor.redraftQueued"));
                    } catch (caught) {
                      const code = problemOf(caught)?.code ?? "internal_error";
                      setError(errors.has(code) ? errors(code) : errors("internal_error"));
                    }
                  }}
                >
                  {t("editor.redraft")}
                </button>
              </>
            )}
            {section.kind === "custom" && (
              <>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => {
                    const value = window.prompt(t("review.sectionTitle"), title);
                    if (!value?.trim()) return;
                    void write((revision) =>
                      workspace.api.patch<SectionWriteResult>(`${base}/sections/${sectionId}`, {
                        revision,
                        title: { ...(section.title ?? {}), [language]: value.trim() },
                      }),
                    ).catch(() => undefined);
                  }}
                >
                  {t("editor.rename")}
                </button>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={async () => {
                    if (!window.confirm(t("editor.deleteConfirm"))) return;
                    await workspace.api.delete(`${base}/sections/${sectionId}`);
                    window.location.assign(`/${locale}${base}`);
                  }}
                >
                  {t("editor.deleteSection")}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
