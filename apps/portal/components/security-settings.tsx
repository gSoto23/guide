"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import type { StepUpMethod } from "@/lib/step-up";
import { useMe } from "@/lib/use-me";
import { StepUpDialog } from "./step-up-dialog";

interface PasskeyItem {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
}

interface SessionItem {
  id: string;
  token: string;
  deviceLabel?: string | null;
  approxLocation?: string | null;
  updatedAt?: string | Date;
}

/** Passkeys, authenticator app, recovery codes, and sessions (FR-008 to FR-013, T062). */
export function SecuritySettings({ locale }: { locale: string }) {
  const t = useTranslations("security");
  const router = useRouter();
  const me = useMe(locale);
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; backupCodes: string[] } | null>(
    null,
  );
  const [totpCodeInput, setTotpCodeInput] = useState("");
  const [stepUp, setStepUp] = useState<{
    methods: StepUpMethod[];
    retry: () => Promise<void>;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [keys, list, current] = await Promise.all([
      authClient.passkey.listUserPasskeys(),
      authClient.listSessions(),
      authClient.getSession(),
    ]);
    setPasskeys((keys.data as PasskeyItem[] | null) ?? []);
    setSessions((list.data as SessionItem[] | null) ?? []);
    setCurrentToken(current.data?.session.token ?? null);
    setTotpEnabled(
      (current.data?.user as { twoFactorEnabled?: boolean | null } | undefined)
        ?.twoFactorEnabled === true,
    );
  }, []);

  useEffect(() => {
    if (me) void refresh();
  }, [me, refresh]);

  /**
   * Methods that can re-authenticate for factor changes. Once the user has a passkey or an
   * authenticator app, only those count; an email code alone can't swap factors (T103).
   */
  function factorStepUpMethods(): StepUpMethod[] {
    const second: StepUpMethod[] = [
      ...(passkeys.length > 0 ? (["passkey"] as const) : []),
      ...(totpEnabled ? (["totp"] as const) : []),
    ];
    return second.length > 0 ? second : ["email_otp"];
  }

  /** Runs an action; when re-authentication is required, asks for it and retries. */
  async function withStepUp<T extends { error?: { code?: string; status?: number } | null }>(
    action: () => Promise<T>,
    onDone: (result: T) => Promise<void> | void = () => undefined,
  ) {
    const result = await action();
    const code = result.error?.code;
    if (code === "STEP_UP_REQUIRED" || code === "SECOND_FACTOR_REQUIRED") {
      setStepUp({
        methods: factorStepUpMethods(),
        retry: async () => {
          await onDone(await action());
          await refresh();
        },
      });
      return;
    }
    await onDone(result);
    await refresh();
  }

  async function addPasskey() {
    await withStepUp(
      () => authClient.passkey.addPasskey({ name: t("passkeyDefaultName") }),
      (result) => setMessage(result?.error ? t("passkeyAddFailed") : t("passkeyAdded")),
    );
  }

  async function startTotp() {
    await withStepUp(
      () => authClient.twoFactor.enable({}),
      (result) => {
        if (result.error || !result.data || !("totpURI" in result.data)) {
          setMessage(t("totpFailed"));
          return;
        }
        const secret = new URL(result.data.totpURI).searchParams.get("secret") ?? "";
        setTotpSetup({ secret, backupCodes: result.data.backupCodes });
      },
    );
  }

  async function confirmTotp() {
    const result = await authClient.twoFactor.verifyTotp({ code: totpCodeInput });
    if (result.error) {
      setMessage(t("totpFailed"));
      return;
    }
    setTotpSetup(null);
    setMessage(t("totpEnabled"));
    router.refresh();
  }

  async function signOut() {
    await authClient.signOut();
    router.replace(`/${locale}/sign-in`);
  }

  if (!me) {
    return <p className="muted">{t("loading")}</p>;
  }

  return (
    <>
      <h1>{t("title")}</h1>
      {me.requiresMfaIn.length > 0 && !me.mfa.enabled ? (
        <p className="alert alert-error" role="alert">
          {t("mfaRequired")}
        </p>
      ) : null}

      <section className="card" aria-labelledby="passkeys-title">
        <h2 id="passkeys-title">{t("passkeysTitle")}</h2>
        <p className="muted">{t("passkeysBody")}</p>
        <ul>
          {passkeys.map((key) => (
            <li key={key.id}>
              {key.name ?? t("passkeyDefaultName")}{" "}
              <button
                type="button"
                className="button button-link"
                onClick={() =>
                  void withStepUp(() => authClient.passkey.deletePasskey({ id: key.id }))
                }
              >
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="button button-secondary" onClick={() => void addPasskey()}>
          {t("addPasskey")}
        </button>
      </section>

      <section className="card" aria-labelledby="totp-title">
        <h2 id="totp-title">{t("totpTitle")}</h2>
        {totpSetup ? (
          <>
            <p>{t("totpSecret")}</p>
            <code>{totpSetup.secret}</code>
            <p>{t("backupCodes")}</p>
            <ul>
              {totpSetup.backupCodes.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
            <label htmlFor="totp-code">{t("codeLabel")}</label>
            <input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCodeInput}
              onChange={(e) => setTotpCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <button
              type="button"
              className="button button-primary"
              onClick={() => void confirmTotp()}
            >
              {t("confirm")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void startTotp()}
          >
            {t("enableTotp")}
          </button>
        )}
      </section>

      <section className="card" aria-labelledby="sessions-title">
        <h2 id="sessions-title">{t("sessionsTitle")}</h2>
        <ul>
          {sessions.map((s) => (
            <li key={s.id}>
              {s.deviceLabel ?? t("unknownDevice")}
              {s.approxLocation ? ` · ${s.approxLocation}` : ""}
              {s.token === currentToken ? ` · ${t("thisDevice")}` : null}
              {s.token !== currentToken ? (
                <button
                  type="button"
                  className="button button-link"
                  onClick={() =>
                    void withStepUp(() => authClient.revokeSession({ token: s.token }))
                  }
                >
                  {t("signOutDevice")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void withStepUp(() => authClient.revokeOtherSessions())}
        >
          {t("signOutOthers")}
        </button>
      </section>

      <button type="button" className="button button-link" onClick={() => void signOut()}>
        {t("signOut")}
      </button>

      {message ? (
        <p className="alert alert-info" role="status">
          {message}
        </p>
      ) : null}
      {stepUp ? (
        <StepUpDialog
          methods={stepUp.methods}
          onCancel={() => setStepUp(null)}
          onDone={() => {
            const retry = stepUp.retry;
            setStepUp(null);
            void retry();
          }}
        />
      ) : null}
    </>
  );
}
