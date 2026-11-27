"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  AddressCheck,
  OnboardingResponse,
  TimeZoneOption,
  TimeZoneSuggestion,
} from "@guidesk/contracts";
import { apiFetch } from "@/lib/api";
import { countryOptions } from "@/lib/countries";
import type { WorkspaceApi } from "@/lib/properties-api";
import { useOnline, useSessionDraft } from "@/lib/use-online";

/** Form values; numbers stay text until submit so a half-typed field is not lost. */
export interface CoreFactsValue extends Record<string, unknown> {
  name: string;
  addressLine1: string;
  addressUnit: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  timeZone: string;
  checkInTime: string;
  checkoutTime: string;
  maxGuests: string;
  guideLanguages: ("es" | "en")[];
}

/** What the API accepts as core facts (contracts: createPropertySchema without the source). */
export interface CoreFactsBody {
  name: string;
  addressLine1: string;
  addressUnit: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
  timeZone: string;
  checkInTime: string;
  checkoutTime: string;
  maxGuests: number;
  guideLanguages: ("es" | "en")[];
}

export function emptyFacts(locale: string): CoreFactsValue {
  return {
    name: "",
    addressLine1: "",
    addressUnit: "",
    city: "",
    region: "",
    postalCode: "",
    country: "",
    timeZone: "",
    checkInTime: "15:00",
    checkoutTime: "11:00",
    maxGuests: "",
    // Spanish and English, the workspace's language first (FR-003).
    guideLanguages: locale === "en" ? ["en", "es"] : ["es", "en"],
  };
}

function toBody(value: CoreFactsValue): CoreFactsBody {
  const optional = (text: string) => (text.trim() === "" ? null : text.trim());
  return {
    name: value.name.trim(),
    addressLine1: value.addressLine1.trim(),
    addressUnit: optional(value.addressUnit),
    city: value.city.trim(),
    region: optional(value.region),
    postalCode: optional(value.postalCode),
    country: value.country,
    timeZone: value.timeZone,
    checkInTime: value.checkInTime,
    checkoutTime: value.checkoutTime,
    maxGuests: Number(value.maxGuests),
    guideLanguages: value.guideLanguages,
  };
}

export interface CoreFactsFormProps {
  api: WorkspaceApi;
  locale: string;
  /** Prefilled values: an extraction's proposed facts, a duplicate draft, or an existing property. */
  initial?: Partial<CoreFactsValue>;
  /** sessionStorage key for the offline draft (edge case "offline"). */
  draftKey: string;
  /** The property being edited, left out of the duplicate-address warning. */
  propertyId?: string;
  submitLabel?: string;
  /** Field errors from a `422 validation_failed`. */
  fieldErrors?: Record<string, string[]>;
  onSubmit: (body: CoreFactsBody) => Promise<boolean>;
}

/**
 * The core-facts confirmation step every creation path ends with (FR-001 to FR-007, T044):
 * required markers, the time zone suggested from country and city or chosen among the country's
 * zones, a mismatch warning, a dismissible duplicate-address warning, and an offline draft.
 */
export function CoreFactsForm(props: CoreFactsFormProps) {
  const t = useTranslations("properties.facts");
  const offline = useTranslations("properties.offline");
  const online = useOnline();
  const [value, setValue, clearDraft] = useSessionDraft<CoreFactsValue>(props.draftKey, {
    ...emptyFacts(props.locale),
    ...props.initial,
  });
  const [zones, setZones] = useState<TimeZoneOption[]>([]);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<AddressCheck["matches"]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const autoZone = useRef(!props.initial?.timeZone);
  const countries = useMemo(() => countryOptions(props.locale), [props.locale]);
  const { api, propertyId } = props;

  const set = <K extends keyof CoreFactsValue>(key: K, next: CoreFactsValue[K]) =>
    setValue({ ...value, [key]: next });
  // The latest values, for the suggestion that arrives after a delay: spreading the values from
  // when it was asked for would undo whatever the host typed meanwhile.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });

  // A new property starts in the country the host gave when signing up (feature 021 FR-002),
  // unless a draft, an extraction, or the host already chose one.
  const prefillCountry = !propertyId && !props.initial?.country;
  useEffect(() => {
    if (!prefillCountry) return;
    let cancelled = false;
    apiFetch<OnboardingResponse>("/api/v1/me/onboarding").then(
      (onboarding) => {
        const country = onboarding.country;
        if (cancelled || !country || latest.current.country) return;
        if (!countries.some((option) => option.code === country)) return;
        setValue({ ...latest.current, country, timeZone: "" });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
    // Asked once per form; the latest values come from the ref.
  }, [prefillCountry]);

  // Time zone: suggested from country and city with Guidesk's own data (FR-002).
  useEffect(() => {
    if (!value.country) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ country: value.country });
      if (value.city.trim()) query.set("city", value.city.trim());
      api
        .get<TimeZoneSuggestion>(`/time-zones/suggest?${query.toString()}`, controller.signal)
        .then((result) => {
          setZones(result.choices);
          setSuggested(result.suggested);
          if (result.suggested && autoZone.current) {
            setValue({ ...latest.current, timeZone: result.suggested });
          }
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // Only the country and city drive the suggestion.
  }, [api, value.country, value.city]);

  async function checkAddress() {
    if (!value.addressLine1.trim() || !value.city.trim() || !value.country) return;
    const query = new URLSearchParams({
      line1: value.addressLine1.trim(),
      city: value.city.trim(),
      country: value.country,
    });
    if (value.addressUnit.trim()) query.set("unit", value.addressUnit.trim());
    try {
      const result = await api.get<AddressCheck>(`/properties/address-check?${query.toString()}`);
      setDuplicates(result.matches.filter((match) => match.propertyId !== propertyId));
      setDismissed(false);
    } catch {
      setDuplicates([]);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!online || saving) return;
    setSaving(true);
    try {
      if (await props.onSubmit(toBody(value))) clearDraft();
    } finally {
      setSaving(false);
    }
  }

  const zoneIds = zones.map((zone) => zone.id);
  // The chosen zone is always an option, even before the country's zones load: otherwise the
  // required select reads as empty and the browser silently blocks an early save.
  const unlisted = Boolean(value.timeZone) && !zoneIds.includes(value.timeZone);
  const mismatch = unlisted && zones.length > 0;
  const fieldError = (name: string) =>
    props.fieldErrors?.[name]?.length ? (
      <span className="field-error" id={`${name}-error`}>
        {props.fieldErrors[name]!.join(" ")}
      </span>
    ) : null;
  const required = (label: string) => (
    <>
      {label} <span aria-hidden="true">*</span>
    </>
  );

  return (
    <form onSubmit={submit} noValidate={false} aria-describedby="facts-intro">
      <p id="facts-intro" className="muted">
        {t("intro")}
      </p>
      <label>
        {required(t("name"))}
        <input
          required
          maxLength={120}
          value={value.name}
          aria-invalid={Boolean(props.fieldErrors?.name)}
          onChange={(event) => set("name", event.target.value)}
        />
        {fieldError("name")}
      </label>
      <label>
        {required(t("country"))}
        <select
          required
          value={value.country}
          onChange={(event) => setValue({ ...value, country: event.target.value, timeZone: "" })}
          onBlur={checkAddress}
        >
          <option value="">{t("countryPlaceholder")}</option>
          {countries.map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
        {fieldError("country")}
      </label>
      <label>
        {required(t("addressLine1"))}
        <input
          required
          maxLength={200}
          autoComplete="address-line1"
          value={value.addressLine1}
          onChange={(event) => set("addressLine1", event.target.value)}
          onBlur={checkAddress}
        />
        {fieldError("addressLine1")}
      </label>
      <label>
        {t("addressUnit")}
        <input
          maxLength={100}
          autoComplete="address-line2"
          value={value.addressUnit}
          onChange={(event) => set("addressUnit", event.target.value)}
          onBlur={checkAddress}
        />
      </label>
      {/* Feature 017 FR-011: short address fields share a row from 600 px. */}
      <div className="field-row field-row-3">
        <label>
          {required(t("city"))}
          <input
            required
            maxLength={120}
            autoComplete="address-level2"
            value={value.city}
            onChange={(event) => set("city", event.target.value)}
            onBlur={checkAddress}
          />
          {fieldError("city")}
        </label>
        <label>
          {t("region")}
          <input
            maxLength={120}
            autoComplete="address-level1"
            value={value.region}
            onChange={(event) => set("region", event.target.value)}
          />
        </label>
        <label>
          {t("postalCode")}
          <input
            maxLength={20}
            autoComplete="postal-code"
            value={value.postalCode}
            onChange={(event) => set("postalCode", event.target.value)}
          />
        </label>
      </div>
      {duplicates.length > 0 && !dismissed ? (
        <div className="alert alert-info" role="status">
          <p>{t("duplicateAddress", { names: duplicates.map((m) => m.name).join(", ") })}</p>
          <button type="button" className="button-link" onClick={() => setDismissed(true)}>
            {t("duplicateAddressDismiss")}
          </button>
        </div>
      ) : null}
      <label>
        {required(t("timeZone"))}
        <select
          required
          value={value.timeZone}
          disabled={!value.country}
          aria-describedby="timezone-help"
          onChange={(event) => {
            autoZone.current = false;
            set("timeZone", event.target.value);
          }}
        >
          <option value="">{t("timeZonePlaceholder")}</option>
          {unlisted ? <option value={value.timeZone}>{value.timeZone}</option> : null}
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.name} · {zone.offset}
            </option>
          ))}
        </select>
        <span id="timezone-help" className="muted">
          {mismatch
            ? null
            : suggested && value.timeZone === suggested
              ? t("timeZoneSuggested")
              : zones.length > 1
                ? t("timeZoneChoose")
                : null}
        </span>
        {mismatch ? (
          <span className="field-warning" role="status">
            {t("timeZoneMismatch")}
          </span>
        ) : null}
        {fieldError("timeZone")}
      </label>
      <div className="field-row">
        <label>
          {required(t("checkInTime"))}
          <input
            type="time"
            required
            value={value.checkInTime}
            onChange={(event) => set("checkInTime", event.target.value)}
          />
        </label>
        <label>
          {required(t("checkoutTime"))}
          <input
            type="time"
            required
            value={value.checkoutTime}
            onChange={(event) => set("checkoutTime", event.target.value)}
          />
        </label>
      </div>
      <p className="muted">{t("timesNote")}</p>
      <label>
        {required(t("maxGuests"))}
        <input
          type="number"
          inputMode="numeric"
          required
          min={1}
          max={50}
          value={value.maxGuests}
          onChange={(event) => set("maxGuests", event.target.value)}
        />
        {fieldError("maxGuests")}
      </label>
      <fieldset>
        <legend>{required(t("guideLanguages"))}</legend>
        {(["es", "en"] as const).map((language) => (
          <label key={language} className="choice">
            <input
              type="checkbox"
              checked={value.guideLanguages.includes(language)}
              onChange={(event) =>
                set(
                  "guideLanguages",
                  event.target.checked
                    ? [...value.guideLanguages, language]
                    : value.guideLanguages.filter((item) => item !== language),
                )
              }
            />
            {t(`languages.${language}`)}
          </label>
        ))}
        {fieldError("guideLanguages")}
      </fieldset>
      {!online ? (
        <p className="alert alert-info" role="status">
          {offline("notice")} {offline("draftSaved")}
        </p>
      ) : null}
      <button
        type="submit"
        className="button button-primary"
        disabled={!online || saving || value.guideLanguages.length === 0}
        title={online ? undefined : offline("actionDisabled")}
      >
        {saving ? t("saving") : (props.submitLabel ?? t("save"))}
      </button>
    </form>
  );
}
