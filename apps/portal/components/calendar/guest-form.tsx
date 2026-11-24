"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { Stay } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

export interface GuestFormProps {
  stayId: string;
  name: string | null;
  /** Omit to edit the name only (the conversation screen). */
  count?: number | null;
  label?: string;
  submitLabel: string;
  onSaved: (stay: Stay) => void;
  onCancel?: () => void;
}

/**
 * The guest's name, and the number of guests when given, for one stay (feature 018 FR-015, FR-018).
 * Owners and admins only; the API refuses others. The name stays on the host side.
 */
export function GuestForm(props: GuestFormProps) {
  const t = useTranslations("stayView");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [name, setName] = useState(props.name ?? "");
  const [count, setCount] = useState(props.count == null ? "" : String(props.count));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withCount = props.count !== undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      const trimmed = name.trim();
      const body: { guestName: string | null; guestCount?: number | null } = {
        guestName: trimmed ? trimmed : null,
      };
      if (withCount) body.guestCount = count.trim() === "" ? null : Number(count);
      const stay = await workspace.api.put<Stay>(`/stays/${props.stayId}/guest`, body);
      props.onSaved(stay);
    } catch (caught) {
      const problem = problemOf(caught);
      setError(errors(problem?.code ?? "internal_error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="guest-form" onSubmit={(event) => void submit(event)}>
      <label className="field">
        <span>{props.label ?? t("guestName")}</span>
        <input
          value={name}
          maxLength={120}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {withCount ? (
        <label className="field">
          <span>{t("guestCount")}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={500}
            value={count}
            onChange={(event) => setCount(event.target.value)}
          />
        </label>
      ) : null}
      <p className="muted">{t("nameHelp")}</p>
      {error ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" className="button" disabled={busy}>
          {props.submitLabel}
        </button>
        {props.onCancel ? (
          <button type="button" className="button button-secondary" onClick={props.onCancel}>
            {t("cancel")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
