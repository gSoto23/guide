"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ShareOverview } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import { CopyButton } from "./copy-button";
import { StayMessageDialog } from "./stay-message-dialog";
import { StaysCard } from "./stays-card";

/**
 * The Share screen (feature 004 H-16, FR-037 to FR-044): the property link and QR code, the
 * scheduled-message template, and, for owners and admins, the stays with their stay links.
 */
export function ShareScreen({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("share");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [overview, setOverview] = useState<ShareOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [language, setLanguage] = useState<"es" | "en">(locale === "en" ? "en" : "es");
  const base = `/properties/${propertyId}/share`;

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setOverview(await workspace.api.get<ShareOverview>(base));
    } catch {
      setError(errors("internal_error"));
    }
  }, [workspace, base, errors]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspace || !overview) {
    return error ? (
      <p className="alert alert-error" role="alert">
        {error}
      </p>
    ) : null;
  }

  async function regenerate() {
    if (!workspace || !window.confirm(t("regenerate.confirm"))) return;
    setError(null);
    try {
      await workspace.api.post(`${base}/property-link/regenerate`, { confirm: true });
      setNotice(t("regenerate.done"));
      await load();
    } catch (cause) {
      const code = problemOf(cause)?.code;
      setError(errors(code === "guide_not_published" ? code : "internal_error"));
    }
  }

  async function setConfirmation(required: boolean) {
    if (!workspace || !overview) return;
    setError(null);
    // Optimistic: the switch moves at once and returns if the change fails.
    setOverview({ ...overview, settings: { requireConfirmationCode: required } });
    try {
      await workspace.api.patch(`${base}/settings`, { requireConfirmationCode: required });
      await load();
    } catch {
      setOverview(overview);
      setError(errors("internal_error"));
    }
  }

  const apiBase = `/api/v1/workspaces/${workspace.workspaceId}${base}`;

  return (
    <section aria-labelledby="share-title" className="share">
      <p>
        <Link className="back-link" href={`/${locale}/properties/${propertyId}`}>
          {t("back")}
        </Link>
      </p>
      <h1 id="share-title">{t("title", { property: overview.propertyName })}</h1>
      <p className="muted">{t("intro")}</p>
      <p className="alert alert-info" role="note">
        {t("reminder")}
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}
      {!overview.published || !overview.propertyLink ? (
        <div className="card">
          <p>{t("notPublished")}</p>
          <Link
            className="button button-primary"
            href={`/${locale}/properties/${propertyId}/guide`}
          >
            {t("openGuide")}
          </Link>
        </div>
      ) : (
        <>
          <div className="card">
            <h2>{t("propertyLink.title")}</h2>
            <p className="muted">{t("propertyLink.body")}</p>
            <p className="share-url">
              <code>{overview.propertyLink.url}</code>
            </p>
            <p className="muted">{t("propertyLink.opens", { count: overview.opensLast30Days })}</p>
            <div className="actions">
              <CopyButton
                className="button button-primary"
                text={overview.propertyLink.url}
                label={t("propertyLink.copy")}
                copiedLabel={t("propertyLink.copied")}
              />
              <a
                className="button button-secondary"
                href={overview.propertyLink.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("propertyLink.open")}
              </a>
            </div>
            <h3>{t("qr.title")}</h3>
            <p className="muted">{t("qr.body")}</p>
            <div className="actions">
              <a className="button button-secondary" href={`${apiBase}/qr.svg`} download>
                {t("qr.svg")}
              </a>
              <a className="button button-secondary" href={`${apiBase}/qr.png`} download>
                {t("qr.png")}
              </a>
              <Link
                className="button button-secondary"
                href={`/${locale}/properties/${propertyId}/share/poster`}
              >
                {t("qr.poster")}
              </Link>
            </div>
            {workspace.canManage && (
              <p>
                <button type="button" className="button-link" onClick={() => void regenerate()}>
                  {t("regenerate.action")}
                </button>
              </p>
            )}
          </div>
          {overview.templates && (
            <div className="card">
              <h2>{t("template.title")}</h2>
              <p className="muted">{t("template.body")}</p>
              <div className="segmented" role="group" aria-label={t("template.title")}>
                {(["es", "en"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={`button ${language === code ? "button-primary" : "button-secondary"}`}
                    aria-pressed={language === code}
                    onClick={() => setLanguage(code)}
                  >
                    {t(code === "es" ? "template.spanish" : "template.english")}
                  </button>
                ))}
              </div>
              <pre className="share-message" lang={language}>
                {overview.templates[language]}
              </pre>
              <CopyButton
                className="button button-primary"
                text={overview.templates[language]}
                label={t("template.copy")}
                copiedLabel={t("template.copied")}
              />
              <h3>{t("template.stepsTitle")}</h3>
              <ul>
                <li>{t("template.airbnb")}</li>
                <li>{t("template.booking")}</li>
                <li>{t("template.vrbo")}</li>
              </ul>
            </div>
          )}
          {workspace.canManage && overview.settings && (
            <div className="card">
              <h2>{t("confirmation.title")}</h2>
              <p className="muted">{t("confirmation.body")}</p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={overview.settings.requireConfirmationCode}
                  onChange={(event) => void setConfirmation(event.target.checked)}
                />{" "}
                {t("confirmation.toggle")}
              </label>
              <p className="muted">
                {overview.settings.requireConfirmationCode
                  ? t("confirmation.on")
                  : t("confirmation.off")}
              </p>
            </div>
          )}
          {workspace.canManage && overview.stays && (
            <StaysCard
              locale={locale}
              propertyId={propertyId}
              stays={overview.stays}
              requireConfirmationCode={overview.settings?.requireConfirmationCode ?? false}
              onChange={load}
            >
              {(stay) =>
                stay.link.status === "ended" ? null : (
                  <StayMessageDialog locale={locale} propertyId={propertyId} stay={stay} />
                )
              }
            </StaysCard>
          )}
        </>
      )}
    </section>
  );
}
