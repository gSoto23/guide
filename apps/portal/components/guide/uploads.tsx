"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  DocumentList,
  DocumentUpload,
  DocumentView,
  GuideView,
  MediaUpload,
  MediaView,
  SectionWriteResult,
} from "@guidesk/contracts";
import { GuideDocumentView, type RenderableDocument } from "@guidesk/ui";
import { sectionTitle } from "@/lib/guide/labels";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

const POLL_MS = 3_000;
const MEDIA_POLL_MS = 2_000;
const MEDIA_GIVE_UP_MS = 4 * 60 * 1000;

interface LocalPhoto {
  blob: Blob;
  fileName: string;
}

/**
 * Manuals and photos (screen H-15, feature 003 US6, FR-039 to FR-041): PDFs and photos go to the
 * uploads bucket through presigned forms, the worker reads their text in the sandbox and deletes
 * them, and suggestions arrive as unreviewed items to accept, edit, or discard. A photo uploaded in
 * this visit can also be added to a section as an image.
 */
export function Uploads({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [documents, setDocuments] = useState<DocumentView[] | null>(null);
  const [view, setView] = useState<GuideView | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const photos = useRef(new Map<string, LocalPhoto>());
  const [targets, setTargets] = useState<Record<string, string>>({});
  const base = `/properties/${propertyId}/guide`;

  const load = useCallback(async () => {
    if (!workspace) return;
    const [list, guide] = await Promise.all([
      workspace.api.get<DocumentList>(`${base}/documents`),
      workspace.api.get<GuideView>(base),
    ]);
    setDocuments(list.items);
    setView(guide);
  }, [workspace, base]);

  useEffect(() => {
    void load().catch(() => setError(errors("internal_error")));
  }, [load, errors]);

  const busy = documents?.some((doc) => doc.status === "checking" || doc.status === "reading");
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => void load().catch(() => undefined), POLL_MS);
    return () => clearTimeout(timer);
  }, [busy, documents, load]);

  if (!workspace) return null;

  function failure(caught: unknown) {
    const code = problemOf(caught)?.code ?? "internal_error";
    setError(errors.has(code) ? errors(code) : errors("internal_error"));
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(0, 10);
    event.target.value = "";
    if (!workspace || files.length === 0) return;
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      // Photos are re-encoded in the browser first, which converts HEIC and drops location data.
      const prepared: { blob: Blob; fileName: string; contentType: string }[] = [];
      for (const file of files) {
        if (file.type === "application/pdf") {
          prepared.push({ blob: file, fileName: file.name, contentType: "application/pdf" });
          continue;
        }
        const { normalizeImage } = await import("@/lib/image-normalize");
        const normalized = await normalizeImage(file);
        if (!normalized.ok) {
          // A file that does not open as an image never leaves the device.
          setError(t("uploads.photoUnreadable", { name: file.name }));
          continue;
        }
        prepared.push({ blob: normalized.blob, fileName: file.name, contentType: "image/jpeg" });
      }
      if (prepared.length === 0) return;
      const uploads = await workspace.api.post<DocumentUpload[]>(
        `${base}/documents`,
        {
          files: prepared.map((file) => ({
            fileName: file.fileName.slice(0, 200) || "file",
            contentType: file.contentType,
            size: file.blob.size,
          })),
        },
        { idempotent: true },
      );
      for (const [index, created] of uploads.entries()) {
        const file = prepared[index]!;
        const body = new FormData();
        for (const [name, value] of Object.entries(created.upload.fields)) body.append(name, value);
        body.append("file", file.blob, file.fileName || "file");
        const sent = await fetch(created.upload.url, { method: "POST", body });
        if (!sent.ok) continue;
        if (file.contentType !== "application/pdf") {
          photos.current.set(created.documentId, { blob: file.blob, fileName: file.fileName });
        }
        await workspace.api.post(`${base}/documents/${created.documentId}/complete`);
      }
      await load();
    } catch (caught) {
      failure(caught);
    } finally {
      setUploading(false);
    }
  }

  function sectionOfItem(itemId: string) {
    return view?.sections.find((section) => section.items.some((item) => item.id === itemId));
  }

  async function itemAction(itemId: string, action: "approve" | "discard") {
    const section = sectionOfItem(itemId);
    if (!workspace || !section) return;
    setError(null);
    try {
      if (action === "approve") {
        await workspace.api.post<SectionWriteResult>(`${base}/items/${itemId}/approve`, {
          revision: section.revision,
        });
      } else {
        await workspace.api.delete<SectionWriteResult>(`${base}/items/${itemId}`, {
          revision: section.revision,
        });
      }
      await load();
    } catch (caught) {
      failure(caught);
    }
  }

  async function remove(documentId: string) {
    if (!workspace) return;
    try {
      await workspace.api.delete(`${base}/documents/${documentId}`);
      photos.current.delete(documentId);
      await load();
    } catch (caught) {
      failure(caught);
    }
  }

  /** Adds a photo from this visit to a section as an image, through the media flow (R9). */
  async function addPhoto(documentId: string) {
    const photo = photos.current.get(documentId);
    const sectionId = targets[documentId];
    const section = view?.sections.find((candidate) => candidate.id === sectionId);
    if (!workspace || !photo || !section || !view) return;
    setError(null);
    try {
      const created = await workspace.api.post<MediaUpload>(
        `${base}/media`,
        {
          kind: "image",
          contentType: "image/jpeg",
          size: photo.blob.size,
          fileName: photo.fileName.slice(0, 200) || "photo",
        },
        { idempotent: true },
      );
      const body = new FormData();
      for (const [name, value] of Object.entries(created.upload.fields)) body.append(name, value);
      body.append("file", photo.blob, photo.fileName || "photo");
      const sent = await fetch(created.upload.url, { method: "POST", body });
      if (!sent.ok) throw new Error("upload failed");
      let media = await workspace.api.post<MediaView>(`${base}/media/${created.mediaId}/complete`);
      const started = Date.now();
      while (media.status === "processing" && Date.now() - started < MEDIA_GIVE_UP_MS) {
        await new Promise((resolve) => setTimeout(resolve, MEDIA_POLL_MS));
        media = await workspace.api.get<MediaView>(`${base}/media/${created.mediaId}`);
      }
      if (media.status !== "ready") throw new Error("media not ready");
      await workspace.api.post<SectionWriteResult>(
        `${base}/sections/${section.id}/items`,
        {
          revision: section.revision,
          kind: "image",
          language: view.mainLanguage,
          mediaId: media.id,
        },
        { idempotent: true },
      );
      setNotice(t("uploads.added", { section: sectionTitle(t, section, locale) }));
      await load();
    } catch (caught) {
      failure(caught);
    }
  }

  const statusText = (doc: DocumentView) =>
    doc.status === "done" && !doc.rejectReason
      ? t("uploads.status_done", { count: doc.suggestionItemIds.length })
      : doc.status === "done" || doc.status === "rejected"
        ? doc.rejectReason
          ? t(`uploads.reason_${doc.rejectReason}`)
          : t("uploads.status_rejected")
        : t(`uploads.status_${doc.status}`);

  const sections = view?.sections.filter((section) => !section.hidden) ?? [];

  return (
    <section aria-labelledby="uploads-title">
      <p>
        <Link href={`/${locale}${base}`}>{t("editor.backToGuide")}</Link>
      </p>
      <h1 id="uploads-title">{t("uploads.title")}</h1>
      <p className="muted">{t("uploads.intro")}</p>
      <p className="field-hint">{t("uploads.reminder")}</p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert alert-info" role="status">
          {notice}
        </p>
      )}
      {view?.canEdit && (
        <div className="card">
          <p className="muted">{t("uploads.limit")}</p>
          <div className="actions">
            <label className="button button-primary">
              {uploading ? t("uploads.uploading") : t("uploads.pick")}
              <input
                type="file"
                accept="application/pdf,image/*"
                multiple
                hidden
                disabled={uploading}
                onChange={(event) => void pick(event)}
              />
            </label>
            <label className="button button-secondary">
              {t("uploads.takePhoto")}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                disabled={uploading}
                onChange={(event) => void pick(event)}
              />
            </label>
          </div>
        </div>
      )}
      {documents && documents.length === 0 && <p>{t("uploads.empty")}</p>}
      <ul className="property-list" aria-label={t("uploads.title")}>
        {(documents ?? []).map((doc) => {
          const redactions = Object.values(doc.redactions).reduce((sum, count) => sum + count, 0);
          return (
            <li key={doc.id} className="card" data-document={doc.id}>
              <strong>{doc.fileName}</strong>{" "}
              {doc.pages !== null && (
                <span className="muted">{t("uploads.pages", { pages: doc.pages })}</span>
              )}
              <p
                className={
                  doc.status === "checking" || doc.status === "reading" ? "working" : "muted"
                }
                aria-live="polite"
              >
                {statusText(doc)}
              </p>
              {redactions > 0 && (
                <p className="alert alert-info">{t("uploads.redacted", { count: redactions })}</p>
              )}
              {doc.suggestionItemIds.map((itemId) => {
                const section = sectionOfItem(itemId);
                const item = section?.items.find((candidate) => candidate.id === itemId);
                if (!section || !item) return null;
                return (
                  <div key={itemId} className="content-item">
                    <p className="muted">{sectionTitle(t, section, locale)}</p>
                    <GuideDocumentView
                      doc={item.texts[item.sourceLanguage]?.doc as RenderableDocument | null}
                      renderLockedField={() => `🔒 ${t("editor.lockedField")}`}
                    />
                    {view?.canEdit && (
                      <div className="actions">
                        <button
                          type="button"
                          className="button button-primary"
                          onClick={() => void itemAction(itemId, "approve")}
                        >
                          {t("uploads.accept")}
                        </button>
                        <Link
                          className="button-link"
                          href={`/${locale}${base}/sections/${section.id}`}
                        >
                          {t("uploads.edit")}
                        </Link>
                        <button
                          type="button"
                          className="button-link"
                          onClick={() => void itemAction(itemId, "discard")}
                        >
                          {t("uploads.discard")}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {view?.canEdit && doc.kind === "photo" && photos.current.has(doc.id) && (
                <div className="actions">
                  <label htmlFor={`target-${doc.id}`}>{t("uploads.addToSection")}</label>
                  <select
                    id={`target-${doc.id}`}
                    value={targets[doc.id] ?? ""}
                    onChange={(event) =>
                      setTargets((current) => ({ ...current, [doc.id]: event.target.value }))
                    }
                  >
                    <option value="">{t("uploads.chooseSection")}</option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {sectionTitle(t, section, locale)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={!targets[doc.id]}
                    onClick={() => void addPhoto(doc.id)}
                  >
                    {t("uploads.add")}
                  </button>
                </div>
              )}
              {view?.canEdit && (
                <button type="button" className="button-link" onClick={() => void remove(doc.id)}>
                  {t("uploads.remove")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
