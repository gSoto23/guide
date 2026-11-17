"use client";

import { useId, type ChangeEvent, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MAX_SCREENSHOTS, MAX_TEXT } from "@/lib/extractions";

/** A screenshot the host picked, re-encoded in the browser before upload (T061). */
export interface PickedScreenshot {
  id: string;
  name: string;
  status: "preparing" | "ready" | "cannot_decode" | "too_large";
  blob: Blob | null;
}

export interface ListingInputProps {
  text: string;
  onTextChange: (text: string) => void;
  screenshotsEnabled: boolean;
  screenshots: PickedScreenshot[];
  onScreenshotsChange: (update: (current: PickedScreenshot[]) => PickedScreenshot[]) => void;
  busy: boolean;
  online: boolean;
  onSubmit: () => void;
}

/**
 * The paste box and the screenshot picker (FR-009, FR-012): both warn not to include codes. Each
 * picked image is re-encoded on the device first, with the normalizer loaded only when needed.
 */
export function ListingInput(props: ListingInputProps) {
  const t = useTranslations("properties.listing");
  const offline = useTranslations("properties.offline");
  const locale = useLocale();
  const ids = { text: useId(), warning: useId(), counter: useId(), shots: useId() };
  const number = new Intl.NumberFormat(locale);
  const ready = props.screenshots.filter((shot) => shot.status === "ready").length;
  const preparing = props.screenshots.some((shot) => shot.status === "preparing");
  const canSubmit =
    props.online && !props.busy && !preparing && (props.text.trim() !== "" || ready > 0);

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const room = MAX_SCREENSHOTS - props.screenshots.length;
    const files = Array.from(event.target.files ?? []).slice(0, Math.max(0, room));
    event.target.value = "";
    if (files.length === 0) return;
    const picked = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name || t("screenshotUnnamed"),
      status: "preparing" as const,
      blob: null,
    }));
    props.onScreenshotsChange((current) => [...current, ...picked]);
    const { normalizeImage } = await import("@/lib/image-normalize");
    await Promise.all(
      files.map(async (file, index) => {
        const result = await normalizeImage(file);
        const id = picked[index]!.id;
        props.onScreenshotsChange((current) =>
          current.map((shot) =>
            shot.id !== id
              ? shot
              : result.ok
                ? { ...shot, status: "ready", blob: result.blob }
                : { ...shot, status: result.reason },
          ),
        );
      }),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) props.onSubmit();
  }

  const full = props.screenshots.length >= MAX_SCREENSHOTS;
  const shotStatus = (shot: PickedScreenshot) =>
    shot.status === "ready"
      ? t("screenshotReady")
      : shot.status === "preparing"
        ? t("screenshotPreparing")
        : shot.status === "cannot_decode"
          ? t("screenshotCannotDecode")
          : t("screenshotTooLarge");

  return (
    <form onSubmit={submit}>
      <p className="alert alert-info" id={ids.warning}>
        {t("noCodes")}
      </p>
      <label htmlFor={ids.text}>{t("textLabel")}</label>
      <textarea
        id={ids.text}
        rows={10}
        maxLength={MAX_TEXT}
        value={props.text}
        aria-describedby={`${ids.warning} ${ids.counter}`}
        onChange={(event) => props.onTextChange(event.target.value)}
      />
      <span className="field-hint" id={ids.counter}>
        {t("textCounter", {
          count: number.format(props.text.length),
          max: number.format(MAX_TEXT),
        })}
      </span>

      {props.screenshotsEnabled ? (
        <fieldset className="screenshots" aria-describedby={ids.shots}>
          <legend>{t("screenshots")}</legend>
          <p className="muted" id={ids.shots}>
            {t("screenshotsHint", { max: MAX_SCREENSHOTS })} {t("noCodesShort")}
          </p>
          {props.screenshots.length > 0 ? (
            <ul className="file-list">
              {props.screenshots.map((shot) => (
                <li key={shot.id}>
                  <span className="file-name">{shot.name}</span>
                  <span
                    className={
                      shot.status === "ready" || shot.status === "preparing"
                        ? "muted"
                        : "field-error"
                    }
                  >
                    {shotStatus(shot)}
                  </span>
                  <button
                    type="button"
                    className="button-link"
                    aria-label={t("removeScreenshot", { name: shot.name })}
                    onClick={() =>
                      props.onScreenshotsChange((current) =>
                        current.filter((item) => item.id !== shot.id),
                      )
                    }
                  >
                    {t("remove")}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {full ? (
            <p className="muted">{t("screenshotsMax", { max: MAX_SCREENSHOTS })}</p>
          ) : (
            <div className="file-buttons">
              <label className="button button-secondary file-button">
                {t("addScreenshots")}
                <input
                  type="file"
                  className="visually-hidden"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  multiple
                  onChange={pick}
                />
              </label>
              <label className="button button-secondary file-button">
                {t("takePhoto")}
                <input
                  type="file"
                  className="visually-hidden"
                  accept="image/*"
                  capture="environment"
                  onChange={pick}
                />
              </label>
            </div>
          )}
        </fieldset>
      ) : null}

      <button type="submit" className="button button-primary" disabled={!canSubmit}>
        {props.busy ? t("submitting") : t("submit")}
      </button>
      {!props.online ? <p className="muted">{offline("actionDisabled")}</p> : null}
    </form>
  );
}
