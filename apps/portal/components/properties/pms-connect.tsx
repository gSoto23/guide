"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { CreatedPmsConnection, StartOptions } from "@guidesk/contracts";
import { problemOf, problemString } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useStepUp } from "@/lib/use-step-up";
import { useWorkspace } from "@/lib/use-workspace";

type Provider = StartOptions["pmsProviders"][number];

/** Beds24's page for invite codes; the host ticks the three read scopes there (research R7). */
const BEDS24_INVITE_URL = "https://beds24.com/control3.php?pagetype=apiv2";
const HOSTEX_TOKEN_URL = "https://hostex.io/settings/open_api";

/**
 * Connecting a PMS (FR-027, T098): the provider, how to get a read-only credential, and the field
 * for it. Connecting asks the host to confirm it's them first (step-up). The credential is sent
 * once and never shown again; it is not kept in the page or in browser storage.
 */
export function PmsConnect({
  providers,
  initialProvider,
  onConnected,
}: {
  providers: Provider[];
  initialProvider: Provider | null;
  onConnected: (connection: CreatedPmsConnection) => void;
}) {
  const t = useTranslations("properties.pms");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const online = useOnline();
  const { run, dialog } = useStepUp();
  const ids = { credential: useId(), help: useId() };
  const [provider, setProvider] = useState<Provider>(initialProvider ?? providers[0]!);
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; helpUrl?: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!workspace || busy || !credential.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await run(() =>
        workspace.api.post<CreatedPmsConnection>("/pms-connections", {
          provider,
          credential: credential.trim(),
        }),
      );
      if (created) {
        setCredential("");
        onConnected(created);
      }
    } catch (caught) {
      const problem = problemOf(caught);
      if (problem?.code === "invalid_credential") {
        setError({
          text: t(`invalid.${provider}`),
          ...(problemString(problem, "helpUrl")
            ? { helpUrl: problemString(problem, "helpUrl") }
            : {}),
        });
      } else if (problem?.code === "provider_unavailable") {
        setError({ text: t("unavailable") });
      } else if (problem?.code === "validation_failed") {
        setError({ text: t("credentialFormat") });
      } else {
        setError({
          text: errors(
            problem && ["mfa_enrollment_required", "forbidden", "network"].includes(problem.code)
              ? problem.code
              : "internal_error",
          ),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {providers.length > 1 ? (
        <fieldset className="choice-list">
          <legend>{t("provider")}</legend>
          {providers.map((option) => (
            <label key={option} className="checkbox">
              <input
                type="radio"
                name="provider"
                value={option}
                checked={provider === option}
                onChange={() => {
                  setProvider(option);
                  setError(null);
                }}
              />
              {t(`providers.${option}`)}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="card" id={ids.help}>
        <strong>{t(`steps.${provider}.title`)}</strong>
        <ol className="steps">
          <li>{t(`steps.${provider}.one`)}</li>
          <li>{t(`steps.${provider}.two`)}</li>
          <li>{t(`steps.${provider}.three`)}</li>
        </ol>
        <a
          href={provider === "beds24" ? BEDS24_INVITE_URL : HOSTEX_TOKEN_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t(`steps.${provider}.link`)}
        </a>
      </div>
      <p className="muted">{t("readOnly")}</p>
      <label htmlFor={ids.credential}>{t(`credential.${provider}`)}</label>
      <input
        id={ids.credential}
        type="password"
        autoComplete="off"
        spellCheck={false}
        maxLength={4000}
        value={credential}
        aria-describedby={ids.help}
        onChange={(event) => setCredential(event.target.value)}
      />
      {error ? (
        <p className="alert alert-error" role="alert">
          {error.text}{" "}
          {error.helpUrl ? (
            <a href={error.helpUrl} target="_blank" rel="noopener noreferrer">
              {t("help")}
            </a>
          ) : null}
        </p>
      ) : null}
      <button
        type="submit"
        className="button button-primary"
        disabled={busy || !online || credential.trim().length < 8}
      >
        {busy ? t("connecting") : t("connect")}
      </button>
      {dialog}
    </form>
  );
}
