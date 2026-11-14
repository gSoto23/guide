"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import {
  forgetReturnTo,
  forgetSignInEmail,
  readReturnTo,
  readSignInEmail,
} from "@/lib/sign-in-email";

const RESEND_SECONDS = 30;

/** Enter the 6-digit email code (FR-002, T043). */
export function VerifyCodeForm({ locale }: { locale: string }) {
  const t = useTranslations("auth");
  const errors = useTranslations("errors");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  useEffect(() => {
    const remembered = readSignInEmail();
    if (remembered) setEmail(remembered);
    else router.replace(`/${locale}/sign-in`);
  }, [locale, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: failure } = await authClient.signIn.emailOtp({ email, otp: code });
    setBusy(false);
    if (failure) {
      setError(failure.status === 429 ? errors("rate_limited") : t("invalidCode"));
      return;
    }
    forgetSignInEmail();
    const returnTo = readReturnTo();
    forgetReturnTo();
    router.push(returnTo ?? `/${locale}/start`);
  }

  async function resend() {
    setError(null);
    const { error: failure } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });
    if (failure) {
      setError(failure.status === 429 ? errors("rate_limited") : errors("internal_error"));
      return;
    }
    setNotice(t("codeResent"));
    setCooldown(RESEND_SECONDS);
  }

  return (
    <>
      <h1>{t("verifyTitle")}</h1>
      <p className="muted">{t("verifySubtitle", { email })}</p>
      <form onSubmit={verify} noValidate>
        <label htmlFor="code">{t("codeLabel")}</label>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        />
        <button
          type="submit"
          className="button button-primary"
          disabled={busy || code.length !== 6}
        >
          {busy ? t("verifying") : t("verify")}
        </button>
      </form>
      <button type="button" className="button button-link" onClick={resend} disabled={cooldown > 0}>
        {cooldown > 0 ? t("resendIn", { seconds: cooldown }) : t("resend")}
      </button>
      {error ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="alert alert-info" role="status">
          {notice}
        </p>
      ) : null}
    </>
  );
}
