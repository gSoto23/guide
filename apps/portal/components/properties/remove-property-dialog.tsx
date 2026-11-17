"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PropertyRemoval } from "@guidesk/contracts";
import { problemOf, type WorkspaceApi } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useStepUp } from "@/lib/use-step-up";

/**
 * Removing a property (US6, FR-044, T119): the upcoming stays to warn about, the typed name, and
 * a recent sign-in. The property can be restored for 30 days from the removed list.
 */
export function RemovePropertyDialog({
  locale,
  api,
  propertyId,
  name,
  onCancel,
}: {
  locale: string;
  api: WorkspaceApi;
  propertyId: string;
  name: string;
  onCancel: () => void;
}) {
  const t = useTranslations("properties.remove");
  const staysText = useTranslations("properties.stays");
  const errors = useTranslations("errors");
  const router = useRouter();
  const online = useOnline();
  const { run, dialog } = useStepUp();
  const [stays, setStays] = useState<PropertyRemoval["upcomingStays"] | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const path = `/properties/${encodeURIComponent(propertyId)}`;

  useEffect(() => {
    const controller = new AbortController();
    // A dry run lists the upcoming stays without removing anything.
    fetchDryRun(api, path)
      .then((removal) => {
        if (!controller.signal.aborted) setStays(removal.upcomingStays);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStays([]);
      });
    return () => controller.abort();
  }, [api, path]);

  const matches = typed.normalize("NFC").trim() === name.normalize("NFC").trim();

  async function remove(event: FormEvent) {
    event.preventDefault();
    if (!matches) {
      setMessage(t("mismatch"));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const removal = await run(() => api.delete<PropertyRemoval>(path, { typedName: typed }));
      if (!removal) {
        setBusy(false);
        return;
      }
      router.push(`/${locale}/properties?view=removed`);
    } catch (error) {
      const code = problemOf(error)?.code;
      setMessage(
        code === "confirmation_mismatch"
          ? t("mismatch")
          : errors(code === "network" || code === "forbidden" ? code : "internal_error"),
      );
      setBusy(false);
    }
  }

  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${value}T00:00:00Z`),
    );

  return (
    <section className="card danger-zone" aria-labelledby="remove-property-title">
      <h2 id="remove-property-title">{t("title")}</h2>
      <p>{t("intro")}</p>
      {stays === null ? (
        <p className="muted" role="status">
          {t("checking")}
        </p>
      ) : stays.length > 0 ? (
        <div className="alert alert-info" role="status">
          <p>{t("upcoming", { count: stays.length })}</p>
          <ul>
            {stays.map((stay) => (
              <li key={`${stay.checkInDate}-${stay.checkoutDate}-${stay.channel}`}>
                {t("stay", {
                  checkIn: date(stay.checkInDate),
                  checkout: date(stay.checkoutDate),
                  // Stays added by hand carry "Direct", shown in the portal's language.
                  channel: stay.channel === "Direct" ? staysText("direct") : stay.channel,
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted">{t("noUpcoming")}</p>
      )}
      {message ? (
        <p className="alert alert-error" role="alert">
          {message}
        </p>
      ) : null}
      <form className="form" onSubmit={remove} noValidate>
        <label className="field">
          <span>{t("typeName", { name })}</span>
          <input
            type="text"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </label>
        <div className="actions">
          <button
            type="submit"
            className="button button-danger"
            disabled={busy || !online || !matches}
          >
            {busy ? t("removing") : t("confirm")}
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            {t("cancel")}
          </button>
        </div>
      </form>
      {dialog}
    </section>
  );
}

function fetchDryRun(api: WorkspaceApi, path: string): Promise<PropertyRemoval> {
  return api.delete<PropertyRemoval>(`${path}?dryRun=true`);
}
