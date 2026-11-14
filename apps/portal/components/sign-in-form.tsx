"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { rememberSignInEmail } from "@/lib/sign-in-email";

/** Sign-in and sign-up in one screen: Google, passkey, or an email code (spec 001 FR-001, T043). */
export function SignInForm({ locale }: { locale: string }) {
  const t = useTranslations("auth");
  const errors = useTranslations("errors");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = `/${locale}/onboarding`;

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });
    setBusy(false);
    if (failure) {
      setError(failure.status === 429 ? errors("rate_limited") : errors("internal_error"));
      return;
    }
    rememberSignInEmail(email);
    router.push(`/${locale}/verify`);
  }

  async function google() {
    setError(null);
    await authClient.signIn.social({ provider: "google", callbackURL: next });
  }

  async function passkey() {
    setError(null);
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      setError(t("passkeyFailed"));
      return;
    }
    router.push(next);
  }

  return (
    <>
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <button type="button" className="button button-secondary" onClick={google}>
        {t("google")}
      </button>
      <button type="button" className="button button-secondary" onClick={passkey}>
        {t("passkey")}
      </button>

      <div className="divider">{t("or")}</div>

      <form onSubmit={sendCode} noValidate>
        <label htmlFor="email">{t("emailLabel")}</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email webauthn"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button
          type="submit"
          className="button button-primary"
          disabled={busy || !email.includes("@")}
        >
          {busy ? t("sending") : t("sendCode")}
        </button>
      </form>

      {error ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="muted">{t("noPasswords")}</p>
    </>
  );
}
