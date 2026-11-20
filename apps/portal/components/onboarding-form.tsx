"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { OnboardingResponse } from "@guidesk/contracts";
import { PMS_VALUES, PROPERTIES_BUCKET_VALUES } from "@guidesk/contracts/values";
import { ApiError, apiFetch } from "@/lib/api";
import { useMe } from "@/lib/use-me";
import { Illustration, welcomeScene } from "@guidesk/ui";

/** Countries shown first: the launch markets (LATAM + US). Any other country can be skipped. */
const COUNTRIES = ["CR", "MX", "CO", "PA", "GT", "DO", "PE", "AR", "CL", "BR", "US"] as const;

/** At most three optional questions (FR-005, T044). */
export function OnboardingForm({ locale }: { locale: string }) {
  const t = useTranslations("onboarding");
  const errors = useTranslations("errors");
  const router = useRouter();
  const me = useMe(locale);
  const [bucket, setBucket] = useState<string>("");
  const [pms, setPms] = useState<string>("");
  const [pmsOther, setPmsOther] = useState("");
  const [country, setCountry] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(skipped: boolean) {
    setBusy(true);
    setError(null);
    try {
      const body = skipped
        ? { skipped: true }
        : {
            propertiesBucket: bucket || null,
            pms: pms || null,
            pmsOther: pms === "other" ? pmsOther.trim() || null : null,
            country: country || null,
          };
      const result = await apiFetch<OnboardingResponse>("/api/v1/me/onboarding", {
        method: "PUT",
        body,
      });
      router.push(`/${locale}/properties/new?path=${result.path}`);
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.problem.code : "internal_error";
      setError(errors(code as "internal_error"));
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save(false);
  }

  if (!me) {
    return <p className="muted">{t("loading")}</p>;
  }

  return (
    <form onSubmit={submit}>
      <Illustration data={welcomeScene} width={180} className="page-illustration" />
      <h1>{t("title")}</h1>
      <p className="muted">{t("subtitle")}</p>

      <fieldset>
        <legend>{t("propertiesQuestion")}</legend>
        <div className="choices">
          {PROPERTIES_BUCKET_VALUES.map((value) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="bucket"
                value={value}
                checked={bucket === value}
                onChange={() => setBucket(value)}
              />
              {t(`buckets.${value}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor="pms">{t("pmsQuestion")}</label>
      <select id="pms" value={pms} onChange={(event) => setPms(event.target.value)}>
        <option value="">{t("choose")}</option>
        {PMS_VALUES.map((value) => (
          <option key={value} value={value}>
            {t(`pms.${value}`)}
          </option>
        ))}
      </select>
      {pms === "other" ? (
        <>
          <label htmlFor="pmsOther">{t("pmsOtherLabel")}</label>
          <input
            id="pmsOther"
            maxLength={80}
            value={pmsOther}
            onChange={(event) => setPmsOther(event.target.value)}
          />
        </>
      ) : null}

      <label htmlFor="country">{t("countryQuestion")}</label>
      <select id="country" value={country} onChange={(event) => setCountry(event.target.value)}>
        <option value="">{t("choose")}</option>
        {COUNTRIES.map((code) => (
          <option key={code} value={code}>
            {t(`countries.${code}`)}
          </option>
        ))}
      </select>

      <button type="submit" className="button button-primary" disabled={busy}>
        {t("continue")}
      </button>
      <button
        type="button"
        className="button button-link"
        onClick={() => void save(true)}
        disabled={busy}
      >
        {t("skip")}
      </button>
      {error ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
