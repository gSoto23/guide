"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiFetch, ApiError } from "@/lib/api";
import { useMeContext } from "@/lib/me-context";
import { errorKey, useStepUp } from "@/lib/use-step-up";

const KNOWN = [
  "forbidden",
  "gone",
  "validation_failed",
  "rate_limited",
  "email_in_use",
  "owns_shared_workspace",
] as const;

/** Account settings (FR-028, FR-029, T099): email change, data export, account deletion. */
export function AccountSettings({ locale }: { locale: string }) {
  const t = useTranslations("settings.account");
  const errors = useTranslations("errors");
  const router = useRouter();
  const context = useMeContext();
  const me = context?.me ?? null;
  const { run, dialog } = useStepUp();
  const [newEmail, setNewEmail] = useState("");
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  if (!me) return <p className="muted">{t("title")}…</p>;

  async function attempt(action: () => Promise<void>) {
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ kind: "error", text: errors(errorKey(error, KNOWN)) });
    }
  }

  const requestCode = (event: FormEvent) => {
    event.preventDefault();
    void attempt(async () => {
      const sent = await run(() =>
        apiFetch("/api/v1/me/email-change", { method: "POST", body: { newEmail } }),
      );
      if (sent === undefined) return;
      const normalized = newEmail.trim().toLowerCase();
      setCodeSentTo(normalized);
      setMessage({ kind: "info", text: t("codeSent", { email: normalized }) });
    });
  };

  const confirm = (event: FormEvent) => {
    event.preventDefault();
    void attempt(async () => {
      const result = await apiFetch<{ email: string }>("/api/v1/me/email-change/confirm", {
        method: "POST",
        body: { code },
      });
      setCodeSentTo(null);
      setCode("");
      setNewEmail("");
      await context?.refresh();
      setMessage({ kind: "info", text: t("changed", { email: result.email }) });
    });
  };

  const download = () =>
    void attempt(async () => {
      const data = await run(() => apiFetch<{ exportedAt: string }>("/api/v1/me/export"));
      if (!data) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `guidesk-export-${data.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    });

  const remove = () => {
    if (!window.confirm(t("deleteConfirm"))) return;
    void attempt(async () => {
      try {
        const scheduled = await run(() => apiFetch("/api/v1/me", { method: "DELETE" }));
        if (scheduled === undefined) return;
      } catch (error) {
        if (error instanceof ApiError && error.problem.status === 401) {
          router.replace(`/${locale}/sign-in`);
          return;
        }
        throw error;
      }
      router.replace(`/${locale}/sign-in`);
    });
  };

  return (
    <>
      <h1>{t("title")}</h1>
      {message ? (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-info"}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}

      <section className="card" aria-labelledby="email-title">
        <h2 id="email-title">{t("emailTitle")}</h2>
        <p className="muted">{t("current", { email: me.user.email })}</p>
        {codeSentTo ? (
          <form onSubmit={confirm} noValidate>
            <label htmlFor="email-code">{t("codeLabel")}</label>
            <input
              id="email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button type="submit" className="button button-primary" disabled={code.length !== 6}>
              {t("confirm")}
            </button>
          </form>
        ) : (
          <form onSubmit={requestCode} noValidate>
            <label htmlFor="new-email">{t("newEmail")}</label>
            <input
              id="new-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
            <button
              type="submit"
              className="button button-secondary"
              disabled={!newEmail.includes("@")}
            >
              {t("sendCode")}
            </button>
          </form>
        )}
      </section>

      <section className="card" aria-labelledby="export-title">
        <h2 id="export-title">{t("exportTitle")}</h2>
        <p className="muted">{t("exportBody")}</p>
        <button type="button" className="button button-secondary" onClick={download}>
          {t("export")}
        </button>
      </section>

      <section className="card danger-zone" aria-labelledby="delete-account-title">
        <h2 id="delete-account-title">{t("deleteTitle")}</h2>
        <p className="muted">{t("deleteBody")}</p>
        <button type="button" className="button button-danger" onClick={remove}>
          {t("delete")}
        </button>
      </section>
      {dialog}
    </>
  );
}
