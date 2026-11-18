"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  documentPlainText,
  type GuideView,
  type PublishCheck,
  type PublishResult,
  type SectionWriteResult,
} from "@guidesk/contracts";
import { sectionTitle } from "@/lib/guide/labels";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

/** The first words of an item, so the host knows which one is left out. */
function preview(view: GuideView, itemId: string): string {
  for (const section of view.sections) {
    const item = section.items.find((candidate) => candidate.id === itemId);
    if (!item) continue;
    const doc = item.texts[item.sourceLanguage]?.doc;
    const plain = doc ? documentPlainText(doc).replace(/\s+/g, " ").trim() : "";
    return (plain || item.recommendation?.name || "…").slice(0, 90);
  }
  return "…";
}

/**
 * The publish dialog (feature 003 US3, FR-050, FR-051): blockers, items left out because they need
 * review (with Review and Approve), warnings that never block, and the publish itself, which
 * sends back the check it showed so the host publishes what they reviewed.
 */
export default function PublishDialog({
  locale,
  propertyId,
  view,
  onClose,
  onChanged,
}: {
  locale: string;
  propertyId: string;
  view: GuideView;
  onClose: () => void;
  onChanged: (message?: string) => Promise<void>;
}) {
  const t = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [check, setCheck] = useState<PublishCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/properties/${propertyId}/guide`;

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setCheck(await workspace.api.get<PublishCheck>(`${base}/publish-check`));
    } catch {
      setError(errors("internal_error"));
    }
  }, [workspace, base, errors]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspace) return null;

  const sectionName = (sectionId: string) => {
    const section = view.sections.find((candidate) => candidate.id === sectionId);
    return section ? sectionTitle(t, section, locale) : "";
  };
  const fieldLabel = (fieldId: string) =>
    view.lockedFields.find((field) => field.id === fieldId)?.label ?? t("editor.lockedField");

  async function approve(sectionId: string, itemId: string) {
    if (!workspace) return;
    const section = view.sections.find((candidate) => candidate.id === sectionId);
    if (!section) return;
    setError(null);
    try {
      await workspace.api.post<SectionWriteResult>(`${base}/items/${itemId}/approve`, {
        revision: section.revision,
      });
      await onChanged();
      await load();
    } catch (caught) {
      const code = problemOf(caught)?.code ?? "internal_error";
      setError(errors.has(code) ? errors(code) : errors("internal_error"));
      await onChanged();
    }
  }

  async function publish() {
    if (!workspace || !check) return;
    setBusy(true);
    setError(null);
    try {
      const result = await workspace.api.post<PublishResult>(
        `${base}/publish`,
        { expectedRevisionHash: check.revisionHash },
        { idempotent: true },
      );
      await onChanged(t("publish.published", { number: result.versionNumber }));
      onClose();
    } catch (caught) {
      const code = problemOf(caught)?.code ?? "internal_error";
      if (code === "section_changed") {
        setError(t("publish.changed"));
        await onChanged();
        await load();
      } else {
        setError(errors.has(code) ? errors(code) : errors("internal_error"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" role="dialog" aria-modal="false" aria-labelledby="publish-title">
      <h2 id="publish-title">{t("publish.title")}</h2>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {!check ? (
        <p className="working">{t("publish.checking")}</p>
      ) : (
        <>
          {check.blockers.includes("not_ready") && (
            <p className="alert alert-error">
              {t("publish.notReady")}{" "}
              <Link href={`/${locale}/properties/${propertyId}`}>{t("publish.openProperty")}</Link>
            </p>
          )}
          {check.blockers.includes("pending_deletion") && (
            <p className="alert alert-error">{t("publish.pendingDeletion")}</p>
          )}

          <h3>{t("publish.leftOutTitle")}</h3>
          {check.leftOut.length === 0 ? (
            <p>{t("publish.noLeftOut")}</p>
          ) : (
            <>
              <p className="muted">{t("publish.leftOutIntro")}</p>
              {check.leftOut.map((group) => (
                <div key={group.sectionId}>
                  <strong>{sectionName(group.sectionId)}</strong>
                  <ul className="issue-list">
                    {group.itemIds.map((itemId) => (
                      <li key={itemId}>
                        <span>{preview(view, itemId)}</span>{" "}
                        <Link
                          className="button-link"
                          href={`/${locale}${base}/sections/${group.sectionId}`}
                        >
                          {t("publish.review")}
                        </Link>{" "}
                        <button
                          type="button"
                          className="button-link"
                          onClick={() => void approve(group.sectionId, itemId)}
                        >
                          {t("publish.approve")}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}

          {check.warnings.length > 0 && (
            <>
              <h3>{t("publish.warningsTitle")}</h3>
              <p className="muted">{t("publish.warningsIntro")}</p>
              <ul className="issue-list">
                {check.warnings.map((warning, index) => (
                  <li key={`${warning.kind}-${index}`}>
                    {warning.kind === "missing_essential"
                      ? t("publish.warning_missing_essential", {
                          topic: t(`topics.${warning.topicId}.name`),
                        })
                      : warning.kind === "unset_locked_field"
                        ? t("publish.warning_unset_locked_field", {
                            label: fieldLabel(warning.fieldId),
                          })
                        : warning.kind === "code_like_text" || warning.kind === "off_platform"
                          ? t(`publish.warning_${warning.kind}`, {
                              section: sectionName(warning.sectionId),
                            })
                          : t(`publish.warning_${warning.kind}`, { count: warning.count })}
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="actions">
            <button
              type="button"
              className="button button-primary"
              disabled={!check.ready || busy}
              onClick={() => void publish()}
            >
              {busy ? t("publish.publishing") : t("publish.confirm")}
            </button>
            <button type="button" className="button button-secondary" onClick={onClose}>
              {t("publish.cancel")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
