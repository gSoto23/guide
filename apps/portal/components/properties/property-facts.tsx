"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ConfirmPropertiesResult, PropertyDetail } from "@guidesk/contracts";
import { problemNumber, problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import { CoreFactsForm, type CoreFactsBody } from "./core-facts-form";

// Loaded after the facts, so the page stays inside its JavaScript budget (plan, Performance).
const ListingContent = dynamic(() => import("./listing-content").then((m) => m.ListingContent), {
  ssr: false,
});
const CalendarFeeds = dynamic(() => import("./calendar-feeds").then((m) => m.CalendarFeeds), {
  ssr: false,
});
const StaysList = dynamic(() => import("./stays-list").then((m) => m.StaysList), { ssr: false });
const RestrictedValues = dynamic(
  () => import("./restricted-values").then((m) => m.RestrictedValues),
  { ssr: false },
);
const RemovePropertyDialog = dynamic(
  () => import("./remove-property-dialog").then((m) => m.RemovePropertyDialog),
  { ssr: false },
);

/**
 * A property's page (FR-005, T046): its facts in the property's time zone, editable by owners
 * and admins, read-only for agents, and the next step toward the guide (spec 003).
 */
export function PropertyFacts({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("properties");
  const guide = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [property, setProperty] = useState<PropertyDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [staysVersion, setStaysVersion] = useState(0);
  const [removing, setRemoving] = useState(false);

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

  async function confirm() {
    setMessage(null);
    try {
      const result = await workspace!.api.post<ConfirmPropertiesResult>("/properties/confirm", {
        propertyIds: [propertyId],
      });
      const updated = await workspace!.api.get<PropertyDetail>(`/properties/${propertyId}`);
      setProperty(updated);
      setMessage({
        kind: "info",
        text: result.ready.includes(propertyId) ? t("detail.confirmed") : t("detail.stillMissing"),
      });
    } catch {
      setMessage({ kind: "error", text: errors("internal_error") });
    }
  }

  /** Restores a removed property within 30 days, if the plan has room (FR-045). */
  async function restore() {
    setMessage(null);
    try {
      const restored = await workspace!.api.post<PropertyDetail>(
        `/properties/${propertyId}/restore`,
      );
      setProperty(restored);
      setMessage({ kind: "info", text: t("removed.restored", { name: restored.name }) });
    } catch (error) {
      const problem = problemOf(error);
      setMessage({
        kind: "error",
        text:
          problem?.code === "plan_limit_reached"
            ? t("removed.limitReached", { limit: problemNumber(problem, "limit") ?? 2 })
            : problem?.code === "gone"
              ? t("removed.gone")
              : errors("internal_error"),
      });
    }
  }

  const removed = property.status === "removed";
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
      {!removed ? (
        <p>
          <Link
            className="button button-primary"
            href={`/${locale}/properties/${propertyId}/guide`}
          >
            {guide("review.open")}
          </Link>
        </p>
      ) : null}
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
      {removed ? (
        <div className="card">
          <p>
            {t("removed.banner", {
              date: property.purgeAfter
                ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                    new Date(property.purgeAfter),
                  )
                : "",
            })}
          </p>
          {workspace.canManage ? (
            <button type="button" className="button button-primary" onClick={() => void restore()}>
              {t("removed.restore")}
            </button>
          ) : null}
        </div>
      ) : null}
      {missing && !removed ? (
        <p className="alert alert-info">{t("detail.missing", { facts: missing })}</p>
      ) : null}
      {property.pmsStatus === "not_found" ? (
        <p className="alert alert-info">
          {t("detail.notFoundInPms", {
            provider: property.sourceProvider ? t(`providers.${property.sourceProvider}`) : "PMS",
          })}
        </p>
      ) : null}
      {property.setupStatus === "to_confirm" && workspace.canManage && !removed ? (
        <div className="card">
          <p>{t("detail.toConfirm")}</p>
          <button type="button" className="button button-primary" onClick={() => void confirm()}>
            {t("detail.confirm")}
          </button>
        </div>
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
          {workspace.canManage && !removed ? (
            <div className="actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setEditing(true)}
              >
                {t("detail.edit")}
              </button>
              <Link
                className="button button-secondary"
                href={`/${locale}/properties/new/duplicate?from=${encodeURIComponent(propertyId)}`}
              >
                {t("detail.duplicate")}
              </Link>
            </div>
          ) : !workspace.canManage ? (
            <p className="muted">{t("detail.readOnly")}</p>
          ) : null}
        </>
      )}
      <ListingContent propertyId={propertyId} sourceProvider={property.sourceProvider} />
      {workspace.canManage && property.counts.restrictedValues ? (
        <RestrictedValues propertyId={propertyId} />
      ) : null}
      {workspace.canManage && !removed ? (
        <CalendarFeeds
          propertyId={propertyId}
          onStaysChanged={() => setStaysVersion((version) => version + 1)}
        />
      ) : null}
      <StaysList
        propertyId={propertyId}
        checkInTime={property.checkInTime}
        checkoutTime={property.checkoutTime}
        timeZone={property.timeZone}
        version={staysVersion}
      />
      <div className="card">
        <strong>{t("detail.nextStep")}</strong>
        <p className="muted">{t("detail.nextStepSoon")}</p>
      </div>
      {workspace.canManage && !removed ? (
        removing ? (
          <RemovePropertyDialog
            locale={locale}
            api={workspace.api}
            propertyId={propertyId}
            name={property.name}
            onCancel={() => setRemoving(false)}
          />
        ) : (
          <p>
            <button type="button" className="button-link" onClick={() => setRemoving(true)}>
              {t("remove.open")}
            </button>
          </p>
        )
      ) : null}
    </>
  );
}
