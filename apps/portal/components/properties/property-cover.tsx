"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { PropertyCover } from "@guidesk/contracts";
import { house, Icon } from "@guidesk/ui";
import { MediaUploadButton } from "@/components/guide/media-upload";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * The property's cover photo (feature 016 US1): shown at the top of the property page; managers
 * add, replace, describe, or remove it. The photo goes through the guide media upload (spec 003).
 */
export function PropertyCoverCard({
  propertyId,
  cover: initial,
  canManage,
}: {
  propertyId: string;
  cover: PropertyCover | null;
  canManage: boolean;
}) {
  const t = useTranslations("properties.cover");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [cover, setCover] = useState<PropertyCover | null>(initial);
  const [alt, setAlt] = useState(initial?.alt ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!cover && !canManage) return null;

  async function save(mediaId: string | null, description?: string) {
    if (!workspace) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await workspace.api.put<{ cover: PropertyCover | null }>(
        `/properties/${propertyId}/cover`,
        { mediaId, ...(description ? { alt: description } : {}) },
      );
      setCover(result.cover);
      setAlt(result.cover?.alt ?? "");
      setMessage(mediaId ? t("saved") : t("removed"));
    } catch (caught) {
      const code = problemOf(caught)?.code;
      setMessage(code === "media_not_ready" ? t("processing") : errors("internal_error"));
    } finally {
      setBusy(false);
    }
  }

  function describe(event: FormEvent) {
    event.preventDefault();
    if (cover && alt.trim()) void save(cover.mediaId, alt.trim());
  }

  return (
    <section className="cover-card" aria-labelledby="cover-title">
      <h2 id="cover-title" className="visually-hidden">
        {t("title")}
      </h2>
      {cover ? (
        <img
          className="cover-photo"
          src={cover.url}
          srcSet={cover.smallUrl ? `${cover.smallUrl} 640w, ${cover.url} 1600w` : undefined}
          sizes="(max-width: 52rem) 100vw, 52rem"
          alt={cover.alt}
          width={1600}
          height={900}
        />
      ) : (
        <div className="cover-empty">
          <span className="section-icon">
            <Icon data={house} />
          </span>
          <p>
            <strong>{t("emptyTitle")}</strong>
            <br />
            <span className="muted">{t("emptyHint")}</span>
          </p>
        </div>
      )}
      {canManage ? (
        <div className="cover-actions">
          <MediaUploadButton
            propertyId={propertyId}
            kind="image"
            label={cover ? t("change") : t("add")}
            disabled={busy}
            onReady={async (media) => save(media.id)}
          />
          {cover ? (
            <>
              <form className="cover-alt" onSubmit={describe}>
                <label htmlFor="cover-alt">{t("altLabel")}</label>
                <p className="field-hint">{t("altHint")}</p>
                <input
                  id="cover-alt"
                  maxLength={160}
                  value={alt}
                  onChange={(event) => setAlt(event.target.value)}
                />
                <button type="submit" className="button button-secondary" disabled={busy}>
                  {t("saveAlt")}
                </button>
              </form>
              <button
                type="button"
                className="button-link"
                disabled={busy}
                onClick={() => void save(null)}
              >
                {t("remove")}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p className="muted" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
