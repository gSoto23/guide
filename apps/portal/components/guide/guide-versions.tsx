"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { GuideVersionList, GuideView } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * Published versions (feature 003 US3, FR-055): the latest 20 with who published them and when,
 * a view of each, and restore as the draft, which publishes nothing.
 */
export function GuideVersions({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const router = useRouter();
  const [list, setList] = useState<GuideVersionList | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/properties/${propertyId}/guide`;

  useEffect(() => {
    if (!workspace) return;
    workspace.api.get<GuideVersionList>(`${base}/versions`).then(setList, () => {
      setError(errors("internal_error"));
    });
    setCanEdit(workspace.canManage);
  }, [workspace, base, errors]);

  if (!workspace) return null;

  const dateOf = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );

  async function restore(number: number) {
    if (!workspace || !window.confirm(t("versions.restoreConfirm", { number }))) return;
    setError(null);
    try {
      await workspace.api.post<GuideView>(`${base}/versions/${number}/restore`);
      router.push(`/${locale}${base}?restored=${number}`);
    } catch {
      setError(errors("internal_error"));
    }
  }

  return (
    <section aria-labelledby="versions-title">
      <p>
        <Link className="back-link" href={`/${locale}${base}`}>
          {t("editor.backToGuide")}
        </Link>
      </p>
      <h1 id="versions-title">{t("versions.title")}</h1>
      <p className="muted">{t("versions.intro")}</p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {list && list.items.length === 0 && <p>{t("versions.empty")}</p>}
      <ol className="property-list" aria-label={t("versions.title")}>
        {(list?.items ?? []).map((version) => (
          <li key={version.number} className="property-row">
            <strong>{t("versions.version", { number: version.number })}</strong>{" "}
            {version.current && <span className="badge badge-ready">{t("versions.current")}</span>}
            <span className="property-meta">
              {version.cause === "publish"
                ? t("versions.by", {
                    date: dateOf(version.publishedAt),
                    name: version.publishedBy ?? "—",
                  })
                : t("versions.byShared", { date: dateOf(version.publishedAt) })}
            </span>
            <span className="actions">
              <Link
                className="button-link"
                href={`/${locale}${base}/preview?source=${version.number}`}
              >
                {t("versions.view")}
              </Link>
              {canEdit && (
                <button
                  type="button"
                  className="button-link"
                  onClick={() => void restore(version.number)}
                >
                  {t("versions.restore")}
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
