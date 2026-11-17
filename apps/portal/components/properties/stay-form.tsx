"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { Stay } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useOnline } from "@/lib/use-online";
import { useWorkspace } from "@/lib/use-workspace";

export interface StayFormProps {
  propertyId: string;
  /** The stay being edited; a new stay otherwise. Only stays added by hand are editable. */
  stay?: Stay;
  /** The property's times, the default for every stay (FR-052). */
  defaultCheckInTime: string;
  defaultCheckoutTime: string;
  onSaved: (stay: Stay) => void;
  onCancel: () => void;
}

/**
 * A stay added by hand (FR-052, FR-053, T079): dates, guests, an optional guest name, the channel
 * ("Direct" by default), and times that start as the property's. A time left at the property's
 * is sent as null, so the stay follows later changes to the property's times.
 */
export function StayForm(props: StayFormProps) {
  const t = useTranslations("properties.stays");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const online = useOnline();
  const ids = {
    checkIn: useId(),
    checkout: useId(),
    checkInTime: useId(),
    checkoutTime: useId(),
    guests: useId(),
    name: useId(),
    channel: useId(),
    nameRemoved: useId(),
  };
  const { stay } = props;
  const [value, setValue] = useState({
    checkInDate: stay?.checkInDate ?? "",
    checkoutDate: stay?.checkoutDate ?? "",
    checkInTime: stay?.checkInTime ?? props.defaultCheckInTime,
    checkoutTime: stay?.checkoutTime ?? props.defaultCheckoutTime,
    guestCount: stay?.guestCount ? String(stay.guestCount) : "",
    guestName: stay?.guestName ?? "",
    channel: stay && stay.channel !== "Direct" ? stay.channel : "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof value, next: string) => setValue({ ...value, [key]: next });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!workspace || saving) return;
    setSaving(true);
    setMessage(null);
    setFieldErrors({});
    const body = {
      checkInDate: value.checkInDate,
      checkoutDate: value.checkoutDate,
      checkInTime: value.checkInTime === props.defaultCheckInTime ? null : value.checkInTime,
      checkoutTime: value.checkoutTime === props.defaultCheckoutTime ? null : value.checkoutTime,
      guestCount: value.guestCount ? Number(value.guestCount) : null,
      // A name removed on request is never sent back (FR-053).
      ...(stay?.guestNameRemoved ? {} : { guestName: value.guestName.trim() || null }),
      ...(value.channel.trim()
        ? { channel: value.channel.trim() }
        : stay
          ? { channel: "Direct" }
          : {}),
    };
    try {
      const saved = stay
        ? await workspace.api.patch<Stay>(`/stays/${stay.id}`, body)
        : await workspace.api.post<Stay>(`/properties/${props.propertyId}/stays`, body);
      props.onSaved(saved);
    } catch (error) {
      const problem = problemOf(error);
      if (problem?.code === "validation_failed" && problem.fields) setFieldErrors(problem.fields);
      else
        setMessage(
          errors(
            problem && ["conflict", "forbidden", "network", "not_found"].includes(problem.code)
              ? problem.code
              : "internal_error",
          ),
        );
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (name: string) =>
    fieldErrors[name]?.length ? (
      <span className="field-error">
        {name === "checkoutDate" ? t("checkoutAfterCheckIn") : t("invalid")}
      </span>
    ) : null;

  return (
    <form onSubmit={submit} className="content-item">
      <h3>{stay ? t("editTitle") : t("addTitle")}</h3>
      <div className="field-row">
        <div>
          <label htmlFor={ids.checkIn}>
            {t("checkInDate")} <span aria-hidden="true">*</span>
          </label>
          <input
            id={ids.checkIn}
            type="date"
            required
            value={value.checkInDate}
            onChange={(event) => set("checkInDate", event.target.value)}
          />
          {fieldError("checkInDate")}
        </div>
        <div>
          <label htmlFor={ids.checkout}>
            {t("checkoutDate")} <span aria-hidden="true">*</span>
          </label>
          <input
            id={ids.checkout}
            type="date"
            required
            min={value.checkInDate || undefined}
            value={value.checkoutDate}
            aria-invalid={Boolean(fieldErrors.checkoutDate)}
            onChange={(event) => set("checkoutDate", event.target.value)}
          />
          {fieldError("checkoutDate")}
        </div>
      </div>
      <div className="field-row">
        <div>
          <label htmlFor={ids.checkInTime}>{t("checkInTime")}</label>
          <input
            id={ids.checkInTime}
            type="time"
            required
            value={value.checkInTime}
            onChange={(event) => set("checkInTime", event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={ids.checkoutTime}>{t("checkoutTime")}</label>
          <input
            id={ids.checkoutTime}
            type="time"
            required
            value={value.checkoutTime}
            onChange={(event) => set("checkoutTime", event.target.value)}
          />
        </div>
      </div>
      <span className="field-hint">{t("timesNote")}</span>
      <label htmlFor={ids.guests}>{t("guestCount")}</label>
      <input
        id={ids.guests}
        type="number"
        inputMode="numeric"
        min={1}
        max={50}
        value={value.guestCount}
        onChange={(event) => set("guestCount", event.target.value)}
      />
      {fieldError("guestCount")}
      <label htmlFor={ids.name}>{t("guestName")}</label>
      <input
        id={ids.name}
        maxLength={120}
        autoComplete="off"
        disabled={stay?.guestNameRemoved}
        aria-describedby={stay?.guestNameRemoved ? ids.nameRemoved : undefined}
        value={value.guestName}
        onChange={(event) => set("guestName", event.target.value)}
      />
      {stay?.guestNameRemoved ? (
        <span className="field-hint" id={ids.nameRemoved}>
          {t("nameRemovedNote")}
        </span>
      ) : null}
      <label htmlFor={ids.channel}>{t("channel")}</label>
      <input
        id={ids.channel}
        maxLength={40}
        placeholder={t("direct")}
        value={value.channel}
        onChange={(event) => set("channel", event.target.value)}
      />
      {message ? (
        <p className="alert alert-error" role="alert">
          {message}
        </p>
      ) : null}
      <button type="submit" className="button button-primary" disabled={saving || !online}>
        {stay ? t("saveChanges") : t("save")}
      </button>
      <button type="button" className="button button-secondary" onClick={props.onCancel}>
        {t("cancel")}
      </button>
    </form>
  );
}
