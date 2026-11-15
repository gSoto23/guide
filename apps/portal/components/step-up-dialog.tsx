"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { usePreloadAuthClient } from "@/lib/auth-client";
import {
  currentUserId,
  emailStepUp,
  passkeyStepUp,
  requestEmailStepUp,
  totpStepUp,
  type StepUpMethod,
} from "@/lib/step-up";

/** Re-authentication for sensitive actions (FR-011, T063). */
export function StepUpDialog({
  methods,
  onDone,
  onCancel,
}: {
  methods: StepUpMethod[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("security");
  usePreloadAuthClient();
  // Read before the passkey prompt, which must start right on the tap.
  const userId = useRef<string | undefined>(undefined);
  useEffect(() => {
    void currentUserId().then((id) => {
      userId.current = id;
    });
  }, []);
  const [method, setMethod] = useState<StepUpMethod | null>(
    methods.length === 1 ? (methods[0] ?? null) : null,
  );
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: StepUpMethod) {
    setError(null);
    setMethod(next);
    if (next === "passkey") {
      if (await passkeyStepUp(userId.current)) onDone();
      else setError(t("stepUpFailed"));
    }
    if (next === "email_otp" && !sent) {
      await requestEmailStepUp();
      setSent(true);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = method === "totp" ? await totpStepUp(code) : await emailStepUp(code);
    if (ok) onDone();
    else setError(t("stepUpFailed"));
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="step-up-title" className="card">
      <h2 id="step-up-title">{t("stepUpTitle")}</h2>
      <p className="muted">{t("stepUpBody")}</p>
      {methods.map((m) => (
        <button
          key={m}
          type="button"
          className="button button-secondary"
          onClick={() => void choose(m)}
        >
          {t(`methods.${m}`)}
        </button>
      ))}
      {method === "totp" || (method === "email_otp" && sent) ? (
        <form onSubmit={submit}>
          <label htmlFor="step-up-code">{t("codeLabel")}</label>
          <input
            id="step-up-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
          <button type="submit" className="button button-primary" disabled={code.length !== 6}>
            {t("confirm")}
          </button>
        </form>
      ) : null}
      <button type="button" className="button button-link" onClick={onCancel}>
        {t("cancel")}
      </button>
      {error ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
