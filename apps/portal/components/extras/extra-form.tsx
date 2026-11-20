"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { ExtraCurrency, ExtraInput } from "@guidesk/contracts";
import { MediaUploadButton } from "@/components/guide/media-upload";
import { CURRENCIES } from "@/lib/extras";

/** What the guest picks: no date, a date, a date and a time, or a turnover day (FR-002). */
type When = "none" | "date" | "dateTime" | "early_check_in" | "late_checkout";

const whenOf = (input: ExtraInput): When =>
  input.turnover ?? (input.needsTime ? "dateTime" : input.needsDate ? "date" : "none");

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export const blankExtra = (language: "es" | "en"): ExtraInput => ({
  sourceLanguage: language,
  name: {},
  description: {},
  price: 0,
  currency: "USD",
  leadTimeHours: 24,
  weekdays: [...WEEKDAYS],
  needsDate: true,
  needsTime: false,
  dateRange: "stay",
  maxPerStay: 1,
  preApproved: false,
  turnover: null,
  visible: true,
});

interface Fields {
  sourceLanguage: "es" | "en";
  nameEs: string;
  nameEn: string;
  descriptionEs: string;
  descriptionEn: string;
  price: string;
  currency: ExtraCurrency;
  leadTimeHours: string;
  weekdays: number[];
  when: When;
  turnoverTime: boolean;
  dateRange: ExtraInput["dateRange"];
  maxPerStay: string;
  preApproved: boolean;
  visible: boolean;
}

const fieldsOf = (input: ExtraInput): Fields => ({
  sourceLanguage: input.sourceLanguage,
  nameEs: input.name.es ?? "",
  nameEn: input.name.en ?? "",
  descriptionEs: input.description.es ?? "",
  descriptionEn: input.description.en ?? "",
  price: String(input.price),
  currency: input.currency,
  leadTimeHours: String(input.leadTimeHours),
  weekdays: input.weekdays,
  when: whenOf(input),
  turnoverTime: input.turnover !== null && input.needsTime,
  dateRange: input.dateRange,
  maxPerStay: String(input.maxPerStay),
  preApproved: input.preApproved,
  visible: input.visible,
});

type FieldError = "name" | "price" | "leadTime" | "weekdays" | "maxPerStay";

/** Validates like the API's schema and returns the body, or the fields that need fixing. */
function toInput(fields: Fields): { input: ExtraInput } | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  const name = { es: fields.nameEs.trim(), en: fields.nameEn.trim() };
  if (!name[fields.sourceLanguage] || name.es.length > 80 || name.en.length > 80) {
    errors.push("name");
  }
  const price = Number(fields.price.replace(",", "."));
  if (
    fields.price.trim() === "" ||
    !Number.isFinite(price) ||
    price < 0 ||
    price > 100_000 ||
    Math.round(price * 100) !== price * 100
  ) {
    errors.push("price");
  }
  const lead = Number(fields.leadTimeHours);
  if (!Number.isInteger(lead) || lead < 0 || lead > 720) errors.push("leadTime");
  if (fields.weekdays.length === 0) errors.push("weekdays");
  const max = Number(fields.maxPerStay);
  if (!Number.isInteger(max) || max < 1 || max > 10) errors.push("maxPerStay");
  if (errors.length > 0) return { errors };
  const turnover =
    fields.when === "early_check_in" || fields.when === "late_checkout" ? fields.when : null;
  const text = (value: string) => (value.trim() ? value.trim() : undefined);
  return {
    input: {
      sourceLanguage: fields.sourceLanguage,
      name: {
        ...(name.es ? { es: name.es } : {}),
        ...(name.en ? { en: name.en } : {}),
      },
      description: {
        ...(text(fields.descriptionEs) ? { es: text(fields.descriptionEs) } : {}),
        ...(text(fields.descriptionEn) ? { en: text(fields.descriptionEn) } : {}),
      },
      price,
      currency: fields.currency,
      leadTimeHours: lead,
      weekdays: [...fields.weekdays].sort((a, b) => a - b),
      needsDate: fields.when === "date" || fields.when === "dateTime",
      needsTime: fields.when === "dateTime" || (turnover !== null && fields.turnoverTime),
      dateRange: turnover ? "stay" : fields.dateRange,
      maxPerStay: turnover ? 1 : max,
      preApproved: fields.preApproved,
      turnover,
      visible: fields.visible,
    },
  };
}

/**
 * The extra's form (feature 008 FR-001, FR-002, FR-006; screen H-27): names and descriptions in
 * Spanish and English, price and currency, notice, days, what the guest picks, and pre-approval.
 */
export function ExtraForm({
  title,
  initial,
  busy,
  onSave,
  onCancel,
  propertyId,
  media,
}: {
  title: string;
  initial: ExtraInput;
  busy: boolean;
  onSave: (input: ExtraInput) => void;
  onCancel: () => void;
  /** Feature 016: with a property, the form offers a photo. */
  propertyId?: string;
  media?: { url: string; smallUrl: string | null } | null;
}) {
  const t = useTranslations("extras");
  const id = useId();
  const [fields, setFields] = useState<Fields>(() => fieldsOf(initial));
  const [photo, setPhoto] = useState<{ id: string | null; url: string | null }>(() => ({
    id: initial.mediaId ?? null,
    url: media?.smallUrl ?? media?.url ?? null,
  }));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));
  const turnover = fields.when === "early_check_in" || fields.when === "late_checkout";

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = toInput(fields);
    if ("errors" in result) {
      setErrors(result.errors);
      document.getElementById(`${id}-${result.errors[0]}`)?.focus();
      return;
    }
    setErrors([]);
    onSave(propertyId ? { ...result.input, mediaId: photo.id } : result.input);
  }

  const error = (field: FieldError) =>
    errors.includes(field) ? (
      <p className="field-error" id={`${id}-${field}-error`}>
        {t(`errorsForm.${field}`)}
      </p>
    ) : null;
  const described = (field: FieldError, hint?: string) => {
    const ids = [hint, errors.includes(field) ? `${id}-${field}-error` : null].filter(Boolean);
    return ids.length > 0 ? ids.join(" ") : undefined;
  };

  return (
    <form className="card extra-form" aria-labelledby={`${id}-title`} onSubmit={submit} noValidate>
      <h2 id={`${id}-title`}>{title}</h2>
      <label htmlFor={`${id}-lang`}>{t("fields.sourceLanguage")}</label>
      <select
        id={`${id}-lang`}
        value={fields.sourceLanguage}
        onChange={(event) => set("sourceLanguage", event.target.value as "es" | "en")}
      >
        <option value="es">Español</option>
        <option value="en">English</option>
      </select>

      <label htmlFor={`${id}-name`}>{t("fields.nameEs")}</label>
      <input
        id={`${id}-name`}
        value={fields.nameEs}
        maxLength={80}
        aria-invalid={errors.includes("name") && (fields.sourceLanguage === "es" || undefined)}
        aria-describedby={described("name", `${id}-name-hint`)}
        onChange={(event) => set("nameEs", event.target.value)}
      />
      <label htmlFor={`${id}-name-en`}>{t("fields.nameEn")}</label>
      <input
        id={`${id}-name-en`}
        value={fields.nameEn}
        maxLength={80}
        aria-invalid={errors.includes("name") && (fields.sourceLanguage === "en" || undefined)}
        aria-describedby={described("name", `${id}-name-hint`)}
        onChange={(event) => set("nameEn", event.target.value)}
      />
      <p className="field-hint" id={`${id}-name-hint`}>
        {t("fields.nameHint")}
      </p>
      {error("name")}

      <label htmlFor={`${id}-description-es`}>{t("fields.descriptionEs")}</label>
      <textarea
        id={`${id}-description-es`}
        value={fields.descriptionEs}
        maxLength={500}
        rows={3}
        onChange={(event) => set("descriptionEs", event.target.value)}
      />
      <label htmlFor={`${id}-description-en`}>{t("fields.descriptionEn")}</label>
      <textarea
        id={`${id}-description-en`}
        value={fields.descriptionEn}
        maxLength={500}
        rows={3}
        onChange={(event) => set("descriptionEn", event.target.value)}
      />

      {propertyId ? (
        <fieldset className="extra-photo">
          <legend>{t("fields.photo")}</legend>
          <p className="field-hint">{t("fields.photoHint")}</p>
          {photo.url ? (
            <img className="extra-photo-preview" src={photo.url} alt="" width={640} height={360} />
          ) : null}
          <div className="actions">
            <MediaUploadButton
              propertyId={propertyId}
              kind="image"
              label={photo.id ? t("fields.photoChange") : t("fields.photoAdd")}
              disabled={busy}
              onReady={async (ready) =>
                setPhoto({ id: ready.id, url: ready.urls.small ?? ready.urls.large ?? null })
              }
            />
            {photo.id ? (
              <button
                type="button"
                className="button-link"
                onClick={() => setPhoto({ id: null, url: null })}
              >
                {t("fields.photoRemove")}
              </button>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      <div className="field-row">
        <div>
          <label htmlFor={`${id}-price`}>{t("fields.price")}</label>
          <input
            id={`${id}-price`}
            inputMode="decimal"
            value={fields.price}
            aria-invalid={errors.includes("price") || undefined}
            aria-describedby={described("price", `${id}-price-hint`)}
            onChange={(event) => set("price", event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${id}-currency`}>{t("fields.currency")}</label>
          <select
            id={`${id}-currency`}
            value={fields.currency}
            onChange={(event) => set("currency", event.target.value as ExtraCurrency)}
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="field-hint" id={`${id}-price-hint`}>
        {t("fields.priceHint")}
      </p>
      {error("price")}

      <fieldset className="choices">
        <legend>{t("fields.when")}</legend>
        {(
          [
            ["none", "whenNone"],
            ["date", "whenDate"],
            ["dateTime", "whenDateTime"],
            ["early_check_in", "whenEarly"],
            ["late_checkout", "whenLate"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="checkbox">
            <input
              type="radio"
              name={`${id}-when`}
              value={value}
              checked={fields.when === value}
              onChange={() => set("when", value)}
            />
            {t(`fields.${label}`)}
          </label>
        ))}
      </fieldset>
      {turnover && (
        <>
          <p className="field-hint">{t("fields.turnoverHint")}</p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={fields.turnoverTime}
              onChange={(event) => set("turnoverTime", event.target.checked)}
            />
            {t("fields.timeWithTurnover")}
          </label>
        </>
      )}
      {(fields.when === "date" || fields.when === "dateTime") && (
        <fieldset className="choices">
          <legend>{t("fields.dateRange")}</legend>
          <label className="checkbox">
            <input
              type="radio"
              name={`${id}-range`}
              checked={fields.dateRange === "stay"}
              onChange={() => set("dateRange", "stay")}
            />
            {t("fields.dateRangeStay")}
          </label>
          <label className="checkbox">
            <input
              type="radio"
              name={`${id}-range`}
              checked={fields.dateRange === "before_arrival"}
              onChange={() => set("dateRange", "before_arrival")}
            />
            {t("fields.dateRangeBefore")}
          </label>
        </fieldset>
      )}

      <label htmlFor={`${id}-leadTime`}>{t("fields.leadTime")}</label>
      <input
        id={`${id}-leadTime`}
        inputMode="numeric"
        value={fields.leadTimeHours}
        aria-invalid={errors.includes("leadTime") || undefined}
        aria-describedby={described("leadTime", `${id}-lead-hint`)}
        onChange={(event) => set("leadTimeHours", event.target.value)}
      />
      <p className="field-hint" id={`${id}-lead-hint`}>
        {t("fields.leadTimeHint")}
      </p>
      {error("leadTime")}

      <fieldset
        className="choices weekday-choices"
        aria-describedby={errors.includes("weekdays") ? `${id}-weekdays-error` : undefined}
      >
        <legend>{t("fields.weekdays")}</legend>
        {WEEKDAYS.map((day, index) => (
          <label key={day} className="checkbox">
            <input
              id={index === 0 ? `${id}-weekdays` : undefined}
              type="checkbox"
              checked={fields.weekdays.includes(day)}
              onChange={(event) =>
                set(
                  "weekdays",
                  event.target.checked
                    ? [...fields.weekdays, day]
                    : fields.weekdays.filter((value) => value !== day),
                )
              }
            />
            {t(`weekdayNames.${day}`)}
          </label>
        ))}
      </fieldset>
      {error("weekdays")}

      {!turnover && (
        <>
          <label htmlFor={`${id}-maxPerStay`}>{t("fields.maxPerStay")}</label>
          <input
            id={`${id}-maxPerStay`}
            inputMode="numeric"
            value={fields.maxPerStay}
            aria-invalid={errors.includes("maxPerStay") || undefined}
            aria-describedby={described("maxPerStay")}
            onChange={(event) => set("maxPerStay", event.target.value)}
          />
          {error("maxPerStay")}
        </>
      )}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={fields.preApproved}
          aria-describedby={`${id}-pre-hint`}
          onChange={(event) => set("preApproved", event.target.checked)}
        />
        {t("fields.preApproved")}
      </label>
      <p className="field-hint" id={`${id}-pre-hint`}>
        {t("fields.preApprovedHint")}
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={fields.visible}
          onChange={(event) => set("visible", event.target.checked)}
        />
        {t("fields.visible")}
      </label>
      <p className="muted">{t("policy")}</p>
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? t("saving") : t("save")}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
