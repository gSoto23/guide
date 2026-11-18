"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ShareStay, StayMessage } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useStepUp } from "@/lib/use-step-up";
import { useWorkspace } from "@/lib/use-workspace";
import { CopyButton } from "./copy-button";

/**
 * "Copy stay message" (feature 004 US4, FR-039, FR-040): the language, whether to include the
 * access codes (after a recent sign-in, recorded as an export), the text, and Copy.
 */
export function StayMessageDialog({
  locale,
  propertyId,
  stay,
}: {
  locale: string;
  propertyId: string;
  stay: ShareStay;
}) {
  const t = useTranslations("share");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const { run, dialog } = useStepUp();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<"es" | "en">(locale === "en" ? "en" : "es");
  const [withValues, setWithValues] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = `message-${stay.stayId}`;

  async function generate() {
    if (!workspace) return;
    setError(null);
    try {
      const result = await run(() =>
        workspace.api.post<StayMessage>(
          `/properties/${propertyId}/share/stays/${stay.stayId}/message`,
          { language, withValues },
        ),
      );
      if (result) setText(result.text);
    } catch (cause) {
      const code = problemOf(cause)?.code;
      setError(errors(code === "stay_not_eligible" ? code : "internal_error"));
    }
  }

  if (!open) {
    return (
      <button type="button" className="button button-secondary" onClick={() => setOpen(true)}>
        {t("message.open")}
      </button>
    );
  }

  return (
    <section className="card stay-message" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t("message.title")}</h3>
      <p className="muted">{t("message.body")}</p>
      <label htmlFor={`${id}-language`}>{t("message.language")}</label>
      <select
        id={`${id}-language`}
        className="input"
        value={language}
        onChange={(event) => {
          setLanguage(event.target.value === "en" ? "en" : "es");
          setText(null);
        }}
      >
        <option value="es">{t("template.spanish")}</option>
        <option value="en">{t("template.english")}</option>
      </select>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={withValues}
          onChange={(event) => {
            setWithValues(event.target.checked);
            setText(null);
          }}
        />{" "}
        {t("message.withValues")}
      </label>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="button button-primary" onClick={() => void generate()}>
          {t("message.generate")}
        </button>
        <button type="button" className="button-link" onClick={() => setOpen(false)}>
          {t("message.close")}
        </button>
      </div>
      {text && (
        <>
          <pre className="share-message" lang={language}>
            {text}
          </pre>
          <CopyButton
            className="button button-primary"
            text={text}
            label={t("message.copy")}
            copiedLabel={t("message.copied")}
          />
        </>
      )}
      {dialog}
    </section>
  );
}
