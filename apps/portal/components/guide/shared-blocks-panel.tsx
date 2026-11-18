"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { GuideView, SectionView, SectionWriteResult } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * The workspace's shared blocks for one section (feature 003 US7, FR-058, FR-059, FR-061):
 * override with an own copy, exclude, reset to shared or include again, and "The shared version
 * changed" for copies made from an older revision. Loaded only in sections that have blocks.
 */
export default function SharedBlocksPanel({
  view,
  section,
  propertyId,
  onChanged,
}: {
  view: GuideView;
  section: SectionView;
  propertyId: string;
  onChanged: (result: SectionWriteResult) => Promise<void>;
}) {
  const t = useTranslations("guide.shared");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [error, setError] = useState<string | null>(null);
  const blocks = view.sharedBlocks.filter((block) => block.sectionKind === section.kind);
  if (!workspace || blocks.length === 0 || !view.canEdit) return null;
  const base = `/properties/${propertyId}/guide/shared-blocks`;

  async function act(blockId: string, action: "override" | "exclude" | "link") {
    setError(null);
    try {
      const result =
        action === "link"
          ? await workspace!.api.delete<SectionWriteResult>(`${base}/${blockId}/link`)
          : await workspace!.api.post<SectionWriteResult>(`${base}/${blockId}/${action}`);
      await onChanged(result);
    } catch {
      setError(errors("internal_error"));
    }
  }

  return (
    <div className="card" aria-label={t("badge", { name: "" })}>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {blocks.map((block) => (
        <div key={block.id} className="content-item">
          <span className="badge">{t("badge", { name: block.name })}</span>
          {block.mode === "inherit" && (
            <div className="actions">
              <button
                type="button"
                className="button-link"
                onClick={() => void act(block.id, "override")}
              >
                {t("override")}
              </button>
              <button
                type="button"
                className="button-link"
                onClick={() => void act(block.id, "exclude")}
              >
                {t("exclude")}
              </button>
            </div>
          )}
          {block.mode === "override" && (
            <>
              <p>{t("overridden", { name: block.name })}</p>
              {block.behind && <p className="alert alert-info">{t("behind")}</p>}
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  if (window.confirm(t("resetConfirm", { name: block.name }))) {
                    void act(block.id, "link");
                  }
                }}
              >
                {t("reset")}
              </button>
            </>
          )}
          {block.mode === "exclude" && (
            <>
              <p>{t("excluded", { name: block.name })}</p>
              <button
                type="button"
                className="button-link"
                onClick={() => void act(block.id, "link")}
              >
                {t("include")}
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
