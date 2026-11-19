"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { CopilotDraft, PropertyList } from "@guidesk/contracts";
import { formatMoment, nextRenewal } from "@/lib/plan";
import { problemNumber, problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

const MAX = 4000;
const POLL_MS = 1000;
const GIVE_UP_MS = 20_000;

/**
 * The paste-to-reply copilot (feature 006 US3, FR-009 to FR-014; screen H-22): paste a guest's
 * platform message, pick the property and booking status, and copy a reply drafted from the guide.
 * The pasted text stays when anything fails; nothing is sent anywhere.
 */
export function CopilotView({ locale }: { locale: string }) {
  const t = useTranslations("copilot");
  const checkNames = useTranslations("conversations.why.checkNames");
  const errors = useTranslations("errors");
  const inbox = useTranslations("inbox");
  const workspace = useWorkspace();
  const id = useId();
  const [properties, setProperties] = useState<PropertyList["items"] | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [bookingStatus, setBookingStatus] = useState<"inquiry" | "confirmed">("confirmed");
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<CopilotDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    if (!workspace) return;
    workspace.api
      .get<PropertyList>("/properties?limit=100")
      .then((list) => {
        const published = list.items.filter(
          (item) => item.status === "active" && item.guide?.status === "published",
        );
        setProperties(published);
        setPropertyId((current) => current || published[0]?.id || "");
      })
      .catch(() => setProperties([]));
  }, [workspace]);

  if (!workspace || properties === null) return null;
  if (properties.length === 0) {
    return <p className="muted">{t("noProperties")}</p>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !message.trim() || !propertyId) return;
    setRunning(true);
    setError(null);
    setDraft(null);
    setCopied(false);
    try {
      const base = `/properties/${propertyId}/copilot`;
      const { id: runId } = await workspace.api.post<{ id: string }>(base, {
        message: message.trim(),
        bookingStatus,
        language: locale === "en" ? "en" : "es",
      });
      const started = Date.now();
      while (!cancelled.current && Date.now() - started < GIVE_UP_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        const current = await workspace.api.get<CopilotDraft>(`${base}/${runId}`);
        if (current.status === "done") {
          if (current.outcome === "drafted") setDraft(current);
          else
            setError(
              t(`outcomes.${current.outcome ?? "failed"}`, {
                date: formatMoment(locale, nextRenewal()),
              }),
            );
          return;
        }
      }
      if (!cancelled.current) setError(t("timeout"));
    } catch (cause) {
      const problem = problemOf(cause);
      if (problem?.code === "copilot_paused") {
        const seconds = problemNumber(problem, "retryAfterSeconds") ?? 3600;
        setError(t("paused", { minutes: Math.max(1, Math.ceil(seconds / 60)) }));
      } else if (problem?.code === "guide_not_published") {
        setError(t("notPublished"));
      } else {
        setError(errors("internal_error"));
      }
    } finally {
      setRunning(false);
    }
  }

  async function copy() {
    if (!draft?.draft) return;
    try {
      await navigator.clipboard.writeText(draft.draft);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const failed = draft?.checks.filter((check) => !check.passed) ?? [];
  return (
    <section aria-labelledby={`${id}-title`} className="copilot">
      <p>
        <Link href={`/${locale}/inbox`}>← {inbox("title")}</Link>
      </p>
      <h1 id={`${id}-title`}>{t("title")}</h1>
      <p className="muted">{t("body")}</p>
      <form className="card" onSubmit={(event) => void submit(event)} noValidate>
        <label htmlFor={`${id}-message`}>{t("message")}</label>
        <textarea
          id={`${id}-message`}
          rows={5}
          maxLength={MAX}
          value={message}
          aria-describedby={`${id}-counter`}
          onChange={(event) => setMessage(event.target.value)}
        />
        <span id={`${id}-counter`} className="field-hint">
          {t("counter", { count: [...message].length })}
        </span>
        <label htmlFor={`${id}-property`}>{t("property")}</label>
        <select
          id={`${id}-property`}
          value={propertyId}
          onChange={(event) => setPropertyId(event.target.value)}
        >
          {properties.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <fieldset className="choices">
          <legend>{t("booking")}</legend>
          {(["confirmed", "inquiry"] as const).map((value) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name={`${id}-booking`}
                checked={bookingStatus === value}
                onChange={() => setBookingStatus(value)}
              />
              {t(value)}
            </label>
          ))}
        </fieldset>
        <div className="actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={running || !message.trim() || !propertyId}
          >
            {running ? t("running") : draft ? t("again") : t("submit")}
          </button>
        </div>
      </form>
      <div aria-live="polite">
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {draft?.draft && (
          <section className="card copilot-result" aria-labelledby={`${id}-result`}>
            <h2 id={`${id}-result`}>{t("result")}</h2>
            {draft.caution && (
              <p className="alert alert-warning" role="note">
                {t(`cautions.${draft.caution}`)}
              </p>
            )}
            {draft.passed ? (
              <p>
                <span className="badge badge-ready">{t("passed")}</span>
              </p>
            ) : failed.length > 0 ? (
              <p className="field-warning">
                {t("failedChecks", {
                  checks: failed.map((check) => checkNames(check.check)).join(", "),
                })}
              </p>
            ) : null}
            {draft.covered === false && <p className="field-warning">{t("notCovered")}</p>}
            {draft.removed.length > 0 && (
              <p className="field-hint">
                {t("removed", {
                  items: draft.removed.map((item) => t(`removedItems.${item}`)).join(", "),
                })}
              </p>
            )}
            <p className="transcript-text copilot-draft">{draft.draft}</p>
            {draft.sections.length > 0 && (
              <p className="muted">
                {t("sources")} {draft.sections.map((section) => section.title).join(", ")}
              </p>
            )}
            <div className="actions">
              <button type="button" className="button button-primary" onClick={() => void copy()}>
                {t("copy")}
              </button>
              {copied && (
                <span role="status" className="muted">
                  {t("copied")}
                </span>
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
