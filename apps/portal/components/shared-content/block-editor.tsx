"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  GuideDocument,
  SharedBlockProperties,
  SharedBlockPublishResult,
  SharedBlockView,
} from "@guidesk/contracts";
import { GuideDocumentView, type RenderableDocument } from "@guidesk/ui";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import type { TextItemEditorProps } from "../guide/text-item-editor";

/** Loaded only when the host writes (research R3). */
const TextItemEditor = dynamic<TextItemEditorProps>(() => import("../guide/text-item-editor"), {
  ssr: false,
  loading: () => <div className="guide-editor-content" aria-busy="true" />,
});

/**
 * One shared block (screen H-29, feature 003 US7): its items, written like a section's but
 * without locked fields (FR-057), publishing to every inheriting guide (FR-060), deletion, and
 * which properties inherit, override (and are behind), or exclude it (FR-062).
 */
export function BlockEditor({ locale, blockId }: { locale: string; blockId: string }) {
  const t = useTranslations("sharedContent");
  const guide = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [block, setBlock] = useState<SharedBlockView | null>(null);
  const [properties, setProperties] = useState<SharedBlockProperties | null>(null);
  const [draft, setDraft] = useState<GuideDocument | null>(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const base = `/shared-blocks/${blockId}`;

  const load = useCallback(async () => {
    if (!workspace) return;
    setBlock(await workspace.api.get<SharedBlockView>(base));
    if (workspace.canManage) {
      setProperties(await workspace.api.get<SharedBlockProperties>(`${base}/properties`));
    }
    setConflict(false);
  }, [workspace, base]);

  useEffect(() => {
    void load().catch(() => setError(errors("internal_error")));
  }, [load, errors]);

  if (!workspace) return null;
  if (!block) return <p className="working">{error ?? guide("drafting")}</p>;

  async function run(action: () => Promise<SharedBlockView | void>) {
    setError(null);
    setBusy(true);
    try {
      const result = await action();
      if (result) setBlock(result);
      return true;
    } catch (caught) {
      const code = problemOf(caught)?.code ?? "internal_error";
      if (code === "section_changed") setConflict(true);
      else setError(errors.has(code) ? errors(code) : errors("internal_error"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addText() {
    if (!draft || !block) return;
    const doc = draft;
    const added = await run(() =>
      workspace!.api.post<SharedBlockView>(
        `${base}/items`,
        { revision: block.revision, kind: "text", language: locale === "en" ? "en" : "es", doc },
        { idempotent: true },
      ),
    );
    if (added) {
      setDraft(null);
      setWriting(false);
    }
  }

  async function publish() {
    setError(null);
    setBusy(true);
    try {
      const result = await workspace!.api.post<SharedBlockPublishResult>(`${base}/publish`);
      setNotice(t("published", { count: result.guidesToUpdate }));
      await load();
    } catch {
      setError(errors("internal_error"));
    } finally {
      setBusy(false);
    }
  }

  // Renaming keeps the content and where it is used (feature 021 FR-010).
  async function rename(event: FormEvent) {
    event.preventDefault();
    if (!block || renaming === null || !renaming.trim()) return;
    const name = renaming.trim();
    const saved = await run(() =>
      workspace!.api.patch<SharedBlockView>(base, { revision: block.revision, name }),
    );
    if (saved) {
      setRenaming(null);
      setNotice(t("renamed"));
    }
  }

  async function removeBlock() {
    if (!window.confirm(t("deleteConfirm"))) return;
    const removed = await run(() => workspace!.api.delete(base));
    if (removed) window.location.assign(`/${locale}/shared-content`);
  }

  const people = (entries: { propertyId: string; name: string; behind?: boolean }[] | undefined) =>
    entries && entries.length > 0
      ? entries.map((entry) => `${entry.name}${entry.behind ? ` (${t("behind")})` : ""}`).join(", ")
      : t("none");

  return (
    <section aria-labelledby="block-title">
      <p>
        <Link className="back-link" href={`/${locale}/shared-content`}>
          {t("back")}
        </Link>
      </p>
      <h1 id="block-title">{block.name}</h1>
      {block.canEdit && workspace.canManage ? (
        renaming === null ? (
          <p>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => setRenaming(block.name)}
            >
              {t("rename")}
            </button>
          </p>
        ) : (
          <form className="card" onSubmit={(event) => void rename(event)}>
            <label htmlFor="block-name">{t("nameLabel")}</label>
            <input
              id="block-name"
              value={renaming}
              maxLength={80}
              required
              onChange={(event) => setRenaming(event.target.value)}
            />
            <div className="actions">
              <button
                type="submit"
                className="button button-primary"
                disabled={busy || !renaming.trim()}
              >
                {t("save")}
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setRenaming(null)}
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        )
      ) : null}
      <p className="muted">
        {guide(`sections.${block.sectionKind}`)} ·{" "}
        <span className={block.status === "published" ? "badge badge-ready" : "badge"}>
          {t(`status_${block.status}`)}
        </span>{" "}
        {block.hasUnpublishedChanges && <span className="badge badge-warning">{t("changes")}</span>}
      </p>
      {conflict && (
        <div className="alert alert-error" role="alert">
          {t("changed")}{" "}
          <button type="button" className="button button-secondary" onClick={() => void load()}>
            {t("reload")}
          </button>
        </div>
      )}
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

      <div className="card">
        <h2>{t("items")}</h2>
        {block.items.map((item) => (
          <div key={item.id} className="content-item">
            <GuideDocumentView
              doc={item.texts[item.sourceLanguage]?.doc as RenderableDocument | null}
              renderLockedField={() => ""}
            />
            {block.canEdit && (
              <button
                type="button"
                className="button-link"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    workspace!.api.delete<SharedBlockView>(`/shared-blocks/items/${item.id}`, {
                      revision: block.revision,
                    }),
                  )
                }
              >
                {t("delete")}
              </button>
            )}
          </div>
        ))}
        {block.canEdit &&
          (writing ? (
            <>
              <p className="field-hint">{t("noLocked")}</p>
              <TextItemEditor
                doc={draft}
                labelFor={() => ""}
                onChange={setDraft}
                ariaLabel={t("textPlaceholder")}
              />
              <div className="actions">
                <button
                  type="button"
                  className="button button-primary"
                  disabled={busy || !draft}
                  onClick={() => void addText()}
                >
                  {t("save")}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setWriting(false)}
                >
                  {t("cancel")}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setWriting(true)}
            >
              {t("addText")}
            </button>
          ))}
      </div>

      {block.canEdit && (
        <div className="actions">
          <button
            type="button"
            className="button button-primary"
            disabled={busy || block.items.length === 0}
            onClick={() => void publish()}
          >
            {busy ? t("publishing") : t("publish")}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void removeBlock()}
          >
            {t("deleteBlock")}
          </button>
        </div>
      )}

      {properties && (
        <div className="card">
          <h2>{t("properties")}</h2>
          <p>
            <strong>{t("inherit")}:</strong> {people(properties.inherit)}
          </p>
          <p>
            <strong>{t("override")}:</strong> {people(properties.override)}
          </p>
          <p>
            <strong>{t("exclude")}:</strong> {people(properties.exclude)}
          </p>
        </div>
      )}
    </section>
  );
}
