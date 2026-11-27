"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { LockedFieldView } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useStepUp } from "@/lib/use-step-up";
import { useWorkspace } from "@/lib/use-workspace";

type CodeKind =
  "door_code" | "gate_code" | "lockbox_code" | "alarm_code" | "wifi_password" | "other";

/**
 * A protected field saved from inside the interview (feature 020 FR-001, FR-002): the kind comes
 * from the question, the value is required, and it is created encrypted in the question's section
 * through the usual identity check. Owners and admins only; others see why.
 */
export function InterviewCodeField({
  propertyId,
  sectionKind,
  kinds,
  onSaved,
}: {
  propertyId: string;
  sectionKind: string;
  /** The kinds to choose from; the first is selected. */
  kinds: CodeKind[];
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const { run, dialog } = useStepUp();
  const [kind, setKind] = useState<CodeKind>(kinds[0] ?? "other");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!workspace) return null;
  if (!workspace.canManage) {
    return <p className="alert alert-info">{t("interview.codeAgent")}</p>;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !value) return;
    setBusy(true);
    setError(null);
    try {
      const created = await run(() =>
        workspace.api.post<LockedFieldView>(
          `/properties/${propertyId}/guide/locked-fields`,
          {
            kind,
            ...(label.trim() ? { label: label.trim() } : {}),
            value,
            sectionKind,
          },
          { idempotent: true },
        ),
      );
      // A cancelled identity check saves nothing and keeps the form filled.
      if (!created) return;
      setValue("");
      setLabel("");
      await onSaved();
    } catch (caught) {
      const code = problemOf(caught)?.code ?? "internal_error";
      setError(errors.has(code) ? errors(code) : errors("internal_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="interview-code" onSubmit={(event) => void save(event)}>
      {kinds.length > 1 ? (
        <div>
          <label htmlFor="interview-code-kind">{t("locked.kind")}</label>
          <select
            id="interview-code-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as CodeKind)}
          >
            {kinds.map((item) => (
              <option key={item} value={item}>
                {t(`lockedKinds.${item}`)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div>
        <label htmlFor="interview-code-label">{t("interview.codeLabel")}</label>
        <input
          id="interview-code-label"
          value={label}
          maxLength={60}
          placeholder={t(`lockedKinds.${kind}`)}
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="interview-code-value">{t("interview.codeValue")}</label>
        <span className="code-input">
          <input
            id="interview-code-value"
            type={visible ? "text" : "password"}
            value={value}
            required
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setValue(event.target.value)}
          />
          <button
            type="button"
            className="button button-secondary"
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? t("interview.codeHide") : t("interview.codeShow")}
          </button>
        </span>
      </div>
      <p className="field-hint">{t("interview.codeHint")}</p>
      {error ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy || !value}>
          🔒 {t("interview.codeSave")}
        </button>
      </div>
      {dialog}
    </form>
  );
}
