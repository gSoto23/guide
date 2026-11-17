"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PropertyDetail } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import { CoreFactsForm, type CoreFactsBody } from "./core-facts-form";

/**
 * A property's page (FR-005, T046): its facts in the property's time zone, editable by owners
 * and admins, read-only for agents, and the next step toward the guide (spec 003).
 */
export function PropertyFacts({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("properties");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const controller = new AbortController();
    workspace.api
      .get<PropertyDetail>(`/properties/${propertyId}`, controller.signal)
      .then(setProperty)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const code = problemOf(error)?.code;
        setMessage({
          kind: "error",
          text: errors(code === "not_found" ? "not_found" : "internal_error"),
        });
      });
    return () => controller.abort();
  }, [workspace, propertyId, errors]);

  if (!workspace || (!property && !message)) return <p className="muted">{t("loading")}</p>;
  if (!property) return <p className="alert alert-error">{message?.text}</p>;

  async function save(body: CoreFactsBody): Promise<boolean> {
    setFieldErrors(undefined);
    setMessage(null);
    try {
      const updated = await workspace!.api.patch<PropertyDetail>(`/properties/${propertyId}`, body);
      setProperty(updated);
      setEditing(false);
      setMessage({ kind: "info", text: t("detail.saved") });
      return true;
    } catch (error) {
      const problem = problemOf(error);
      if (problem?.code === "validation_failed") setFieldErrors(problem.fields);
      else
        setMessage({
          kind: "error",
          text: errors(problem?.code === "forbidden" ? "forbidden" : "internal_error"),
        });
      return false;
    }
  }

  const notSet = t("detail.notSet");
  const missing = property.missingFacts.map((fact) => t(`factNames.${fact}`)).join(", ");
  const address = [
    property.addressLine1,
    property.addressUnit,
    property.city,
    property.region,
    property.postalCode,
    property.country,
  ]
    .filter(Boolean)
    .join(", ");
  const zone = property.timeZone ?? notSet;

  return (
    <>
      <p>
        <Link href={`/${locale}/properties`}>{t("detail.back")}</Link>
      </p>
      <h1>{property.name}</h1>
      <p className="property-meta">
        <span
          className={`badge ${property.setupStatus === "ready" ? "badge-ready" : "badge-warning"}`}
        >
          {t(`setupStatus.${property.setupStatus}`)}
        </span>
        <span className="badge">
          {t(`source.${property.source}`, {
            provider: property.sourceProvider ? t(`providers.${property.sourceProvider}`) : "",
          })}
        </span>
      </p>
      {missing ? (
        <p className="alert alert-info">{t("detail.missing", { facts: missing })}</p>
      ) : null}
      {message ? (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-info"}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
      <h2>{t("detail.facts")}</h2>
      {editing ? (
        <>
          <CoreFactsForm
            api={workspace.api}
            locale={locale}
            draftKey={`property:${propertyId}`}
            propertyId={propertyId}
            submitLabel={t("detail.save")}
            fieldErrors={fieldErrors}
            initial={{
              name: property.name,
              addressLine1: property.addressLine1 ?? "",
              addressUnit: property.addressUnit ?? "",
              city: property.city ?? "",
              region: property.region ?? "",
              postalCode: property.postalCode ?? "",
              country: property.country ?? "",
              timeZone: property.timeZone ?? "",
              checkInTime: property.checkInTime ?? "",
              checkoutTime: property.checkoutTime ?? "",
              maxGuests: property.maxGuests ? String(property.maxGuests) : "",
              guideLanguages: property.guideLanguages,
            }}
            onSubmit={save}
          />
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setEditing(false)}
          >
            {t("detail.cancel")}
          </button>
        </>
      ) : (
        <>
          <dl className="facts-list">
            <dt>{t("detail.address")}</dt>
            <dd>{address || notSet}</dd>
            <dt>{t("detail.times")}</dt>
            <dd>
              {t("detail.timesValue", {
                checkIn: property.checkInTime ?? notSet,
                checkout: property.checkoutTime ?? notSet,
                zone,
              })}
            </dd>
            <dt>{t("detail.guests")}</dt>
            <dd>{property.maxGuests ?? notSet}</dd>
            <dt>{t("detail.languages")}</dt>
            <dd>
              {property.guideLanguages
                .map((language) => t(`facts.languages.${language}`))
                .join(", ")}
            </dd>
          </dl>
          {workspace.canManage ? (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setEditing(true)}
            >
              {t("detail.edit")}
            </button>
          ) : (
            <p className="muted">{t("detail.readOnly")}</p>
          )}
        </>
      )}
      <div className="card">
        <strong>{t("detail.nextStep")}</strong>
        <p className="muted">{t("detail.nextStepSoon")}</p>
      </div>
    </>
  );
}
