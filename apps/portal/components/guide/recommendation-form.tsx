"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { Recommendation } from "@guidesk/contracts";
import { BENEFITS, RECOMMENDATION_CATEGORIES } from "@/lib/guide/values";

/**
 * A local recommendation (FR-014, PC-07): the benefit question must be answered before saving, and
 * a "yes" is disclosed to guests in spec 004.
 */
export function RecommendationForm({
  initial,
  initialTip,
  onSave,
  onCancel,
}: {
  initial?: Recommendation | null;
  initialTip?: string;
  onSave: (recommendation: Recommendation, tip: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("guide.recommendation");
  const review = useTranslations("guide.review");
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<Recommendation["category"]>(
    initial?.category ?? "restaurant",
  );
  const [url, setUrl] = useState(initial?.url ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [benefit, setBenefit] = useState<Recommendation["benefit"]>(initial?.benefit);
  const [benefitNote, setBenefitNote] = useState(initial?.benefitNote ?? "");
  const [personalTip, setPersonalTip] = useState(initial?.personalTip ?? false);
  const [tip, setTip] = useState(initialTip ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!benefit || saving) return;
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          category,
          ...(url.trim() ? { url: url.trim() } : {}),
          ...(address.trim() ? { address: address.trim() } : {}),
          benefit,
          ...(benefit !== "none" && benefitNote.trim() ? { benefitNote: benefitNote.trim() } : {}),
          personalTip,
        },
        tip.trim(),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <label htmlFor="rec-name">{t("name")}</label>
      <input
        id="rec-name"
        value={name}
        maxLength={120}
        required
        onChange={(event) => setName(event.target.value)}
      />
      <label htmlFor="rec-category">{t("category")}</label>
      <select
        id="rec-category"
        value={category}
        onChange={(event) => setCategory(event.target.value as Recommendation["category"])}
      >
        {RECOMMENDATION_CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {t(`categories.${value}`)}
          </option>
        ))}
      </select>
      <label htmlFor="rec-tip">{t("description")}</label>
      <textarea
        id="rec-tip"
        value={tip}
        maxLength={2000}
        rows={3}
        onChange={(event) => setTip(event.target.value)}
      />
      <label htmlFor="rec-url">{t("url")}</label>
      <input
        id="rec-url"
        type="url"
        value={url}
        maxLength={2000}
        onChange={(event) => setUrl(event.target.value)}
      />
      <label htmlFor="rec-address">{t("address")}</label>
      <input
        id="rec-address"
        value={address}
        maxLength={200}
        onChange={(event) => setAddress(event.target.value)}
      />
      <fieldset>
        <legend>{t("benefit")}</legend>
        {BENEFITS.map((value) => (
          <label key={value} className="choice">
            <input
              type="radio"
              name="rec-benefit"
              value={value}
              checked={benefit === value}
              required
              onChange={() => setBenefit(value)}
            />
            {t(`benefits.${value}`)}
          </label>
        ))}
      </fieldset>
      {benefit && benefit !== "none" && (
        <>
          <p className="field-hint">{t("disclosure")}</p>
          <label htmlFor="rec-benefit-note">{t("benefitNote")}</label>
          <input
            id="rec-benefit-note"
            value={benefitNote}
            maxLength={200}
            onChange={(event) => setBenefitNote(event.target.value)}
          />
        </>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={personalTip}
          onChange={(event) => setPersonalTip(event.target.checked)}
        />
        {t("personalTip")}
      </label>
      <div className="actions">
        <button
          type="submit"
          className="button button-primary"
          disabled={!benefit || !name.trim() || saving}
        >
          {t("save")}
        </button>
        <button type="button" className="button button-secondary" onClick={onCancel}>
          {review("cancel")}
        </button>
      </div>
    </form>
  );
}
