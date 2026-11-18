"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { GuidePreview, PreviewItem } from "@guidesk/contracts";
import { GuideDocumentView, type RenderableDocument } from "@guidesk/ui";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * The guide as guests will see it (feature 003 US3, FR-054): the draft, the published version, or
 * a numbered one, in each guide language, with locked fields as placeholders and facts current at
 * view time.
 */
export function GuidePreviewView({
  locale,
  propertyId,
  source,
  lang,
}: {
  locale: string;
  propertyId: string;
  source: string;
  lang?: "es" | "en";
}) {
  const t = useTranslations("guide");
  const languageNames = useTranslations("properties.facts.languages");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [preview, setPreview] = useState<GuidePreview | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const base = `/${locale}/properties/${propertyId}/guide`;

  useEffect(() => {
    if (!workspace) return;
    const query = new URLSearchParams({ source, ...(lang ? { lang } : {}) });
    setPreview(null);
    setMissing(false);
    workspace.api
      .get<GuidePreview>(`/properties/${propertyId}/guide/preview?${query.toString()}`)
      .then(setPreview, (caught: unknown) => {
        if (problemOf(caught)?.code === "not_found") setMissing(true);
        else setFailed(true);
      });
  }, [workspace, propertyId, source, lang]);

  if (!workspace) return null;

  const href = (next: { source?: string; lang?: string }) => {
    const query = new URLSearchParams({
      source: next.source ?? source,
      ...((next.lang ?? lang) ? { lang: next.lang ?? lang! } : {}),
    });
    return `${base}/preview?${query.toString()}`;
  };
  const labelFor = (fieldId: string) =>
    preview?.lockedFields.find((field) => field.id === fieldId)?.label ?? t("editor.lockedField");

  function factText(fact: NonNullable<PreviewItem["fact"]>): string {
    if (fact.value === null) return "—";
    switch (fact.key) {
      case "check_in_time":
        return t("facts.check_in_time", { time: fact.value });
      case "checkout_time":
        return t("facts.checkout_time", { time: fact.value });
      case "max_guests":
        return t("facts.max_guests", { count: Number(fact.value) });
      case "address":
        return t("facts.address", { address: fact.value });
    }
  }

  function item(entry: PreviewItem) {
    const doc = entry.doc as RenderableDocument | null;
    const caption = doc ? (
      <GuideDocumentView doc={doc} renderLockedField={(id) => `🔒 ${labelFor(id)}`} />
    ) : null;
    switch (entry.kind) {
      case "fact":
        return entry.fact ? <p>{factText(entry.fact)}</p> : null;
      case "text":
        return caption;
      case "image":
        return (
          <figure>
            {entry.media?.urls.small && (
              <img
                src={entry.media.urls.small}
                alt=""
                width={entry.media.width ?? undefined}
                height={entry.media.height ?? undefined}
                loading="lazy"
                style={{ maxWidth: "100%", height: "auto" }}
              />
            )}
            {caption && <figcaption>{caption}</figcaption>}
          </figure>
        );
      case "video":
        return (
          <figure>
            {entry.media?.urls.original && (
              <video
                src={entry.media.urls.original}
                controls
                preload="metadata"
                style={{ maxWidth: "100%" }}
              />
            )}
            {caption && <figcaption>{caption}</figcaption>}
          </figure>
        );
      case "recommendation":
        return entry.recommendation ? (
          <div>
            <strong>{entry.recommendation.name}</strong> ·{" "}
            {t(`recommendation.categories.${entry.recommendation.category}`)}
            {entry.recommendation.personalTip && (
              <span className="badge">{t("preview.personalTip")}</span>
            )}
            {entry.recommendation.url && (
              <p>
                <a
                  href={entry.recommendation.url}
                  rel="noopener noreferrer nofollow"
                  target="_blank"
                >
                  {entry.recommendation.url}
                </a>
              </p>
            )}
            {caption}
          </div>
        ) : null;
    }
  }

  const sourceLabel = (value: string) =>
    value === "draft"
      ? t("preview.draft")
      : value === "published"
        ? t("preview.published")
        : t("preview.version", { number: Number(value) });

  return (
    <section aria-labelledby="preview-title">
      <p>
        <Link href={base}>{t("editor.backToGuide")}</Link>
      </p>
      <h1 id="preview-title">{t("preview.title")}</h1>
      <p className="muted">{t("preview.intro")}</p>
      <nav className="actions" aria-label={t("preview.title")}>
        {["draft", "published", ...(/^\d+$/.test(source) ? [source] : [])].map((value) => (
          <Link
            key={value}
            href={href({ source: value })}
            className={value === source ? "button button-primary" : "button button-secondary"}
            aria-current={value === source ? "page" : undefined}
          >
            {sourceLabel(value)}
          </Link>
        ))}
      </nav>
      {preview && preview.languages.length > 1 && (
        <nav className="actions" aria-label={t("preview.language")}>
          {preview.languages.map((language) => (
            <Link
              key={language}
              href={href({ lang: language })}
              lang={language}
              className={
                language === preview.language ? "button button-primary" : "button button-secondary"
              }
              aria-current={language === preview.language ? "true" : undefined}
            >
              {languageNames(language)}
            </Link>
          ))}
        </nav>
      )}
      {failed && <p className="alert alert-error">{errors("internal_error")}</p>}
      {missing && <p className="alert alert-info">{t("preview.notPublished")}</p>}
      {preview && (
        <article className="guide-preview" lang={preview.language}>
          <h2>{preview.propertyName}</h2>
          {preview.sections.map((section) => (
            <section key={section.id} className="card" aria-label={section.title ?? undefined}>
              <h3>{section.title ?? t(`sections.${section.kind}`)}</h3>
              {section.items.length === 0 ? (
                <p className="muted">{t("preview.empty")}</p>
              ) : (
                section.items.map((entry) => (
                  <div key={entry.id} className="content-item">
                    {item(entry)}
                  </div>
                ))
              )}
            </section>
          ))}
        </article>
      )}
    </section>
  );
}
