"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { Extraction } from "@guidesk/contracts";
import {
  formatResetTime,
  POLL_MS,
  redactionList,
  SLOW_AFTER_MS,
  type ReviewItem,
} from "@/lib/extractions";
import { problemNumber, problemOf, problemString, type WorkspaceApi } from "@/lib/properties-api";

const PENDING = new Set(["awaiting_uploads", "queued", "running"]);

export interface ExtractionReviewProps {
  api: WorkspaceApi;
  locale: string;
  extractionId: string;
  /** Removed before anything was stored, from the creation response. */
  redactions: Record<string, number>;
  extraction: Extraction | null;
  onExtraction: (extraction: Extraction) => void;
  items: ReviewItem[];
  onItemsChange: (items: ReviewItem[]) => void;
  onRetried: (extractionId: string) => void;
  onPasteInstead: () => void;
  onContinue: () => void;
  online: boolean;
}

/**
 * Waiting for and reviewing an extraction (FR-010 to FR-018, T062): the codes that were removed,
 * screenshots that could not be read, "Try again" after a timeout, and each item labeled "From
 * your listing" until the host edits it.
 */
export function ExtractionReview(props: ExtractionReviewProps) {
  const t = useTranslations("properties.listing");
  const errors = useTranslations("errors");
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { api, extractionId, extraction, onExtraction } = props;
  const done = extraction?.id === extractionId && !PENDING.has(extraction.status);

  // Polls until the job finishes; the job itself stops at 60 seconds (FR-016).
  useEffect(() => {
    if (done) return;
    const controller = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api.get<Extraction>(`/extractions/${extractionId}`, controller.signal);
        if (controller.signal.aborted) return;
        onExtraction(next);
        if (!PENDING.has(next.status)) return;
      } catch {
        if (controller.signal.aborted) return;
      }
      setSlow(Date.now() - started > SLOW_AFTER_MS);
      timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, extractionId, done, onExtraction]);

  async function retry() {
    setRetrying(true);
    setMessage(null);
    try {
      const next = await api.post<{ extractionId: string }>(`/extractions/${extractionId}/retry`);
      props.onRetried(next.extractionId);
    } catch (error) {
      const problem = problemOf(error);
      if (problem?.code === "extraction_limit_reached") {
        setMessage(
          t("limitReached", {
            limit: problemNumber(problem, "limit") ?? 10,
            time: formatResetTime(problemString(problem, "resetsAt"), props.locale),
          }),
        );
      } else {
        setMessage(errors(problem?.code === "network" ? "network" : "internal_error"));
      }
    } finally {
      setRetrying(false);
    }
  }

  const redactions = { ...props.redactions, ...(extraction?.redactions ?? {}) };
  const removed = redactionList(redactions, props.locale, (kind, count) =>
    t(`redactionKinds.${kind}`, { count }),
  );
  const notices = (
    <>
      {removed ? (
        <p className="alert alert-info" role="status">
          {t("redacted", { removed })}
        </p>
      ) : null}
      {message ? (
        <p className="alert alert-error" role="alert">
          {message}
        </p>
      ) : null}
    </>
  );
  const pasteInstead = (
    <button type="button" className="button button-secondary" onClick={props.onPasteInstead}>
      {t("pasteInstead")}
    </button>
  );

  if (!done || !extraction) {
    return (
      <>
        {notices}
        <p className="working" role="status" aria-live="polite">
          {t("working")}
        </p>
        {slow ? <p className="muted">{t("slow")}</p> : null}
      </>
    );
  }

  const failedShots =
    extraction.failedScreenshots > 0 ? (
      <p className="alert alert-error" role="alert">
        {t("screenshotsFailed", { count: extraction.failedScreenshots })}
      </p>
    ) : null;

  if (extraction.status === "failed") {
    const code = extraction.errorCode;
    if (code === "timeout" || code === "ai_unavailable") {
      return (
        <>
          {notices}
          <p className="alert alert-error" role="alert">
            {t(code === "timeout" ? "timeout" : "aiUnavailable")}
          </p>
          <button
            type="button"
            className="button button-primary"
            disabled={retrying || !props.online}
            onClick={retry}
          >
            {t("tryAgain")}
          </button>
          {pasteInstead}
        </>
      );
    }
    return (
      <>
        {notices}
        {failedShots}
        <p className="alert alert-error" role="alert">
          {t("nothingFound")}
        </p>
        {extraction.failedScreenshots > 0 ? pasteInstead : null}
        <button type="button" className="button button-secondary" onClick={props.onPasteInstead}>
          {t("editInput")}
        </button>
        <Link className="button button-secondary" href={`/${props.locale}/properties/new/blank`}>
          {t("startBlank")}
        </Link>
      </>
    );
  }

  return (
    <>
      {notices}
      {failedShots}
      {extraction.failedScreenshots > 0 ? pasteInstead : null}
      <h2>{t("reviewTitle")}</h2>
      <p className="muted">{t("reviewIntro")}</p>
      {props.items.map((item, index) => (
        <ReviewCard
          key={item.kind}
          item={item}
          onChange={(next) =>
            props.onItemsChange(props.items.map((current, i) => (i === index ? next : current)))
          }
        />
      ))}
      <button type="button" className="button button-primary" onClick={props.onContinue}>
        {t("continue")}
      </button>
    </>
  );
}

function ReviewCard({
  item,
  onChange,
}: {
  item: ReviewItem;
  onChange: (item: ReviewItem) => void;
}) {
  const t = useTranslations("properties.listing");
  const ids = { text: useId(), hint: useId(), link: useId() };
  const described = [
    item.kind === "amenities" ? ids.hint : null,
    item.containsLink ? ids.link : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <section className={`content-item${item.keep ? "" : " content-item-dropped"}`}>
      <div className="content-item-head">
        <h3>{t(`kinds.${item.kind}`)}</h3>
        <span className={`badge ${item.edited ? "badge-ready" : "badge-warning"}`}>
          {item.edited ? t("editedByYou") : t("fromListing")}
        </span>
      </div>
      {item.containsLink ? (
        <p className="field-warning" id={ids.link}>
          {t("containsLink")}
        </p>
      ) : null}
      <label htmlFor={ids.text} className="visually-hidden">
        {t(`kinds.${item.kind}`)}
      </label>
      <textarea
        id={ids.text}
        rows={item.kind === "title" ? 2 : 6}
        maxLength={20_000}
        value={item.text}
        disabled={!item.keep}
        aria-describedby={described || undefined}
        onChange={(event) => onChange({ ...item, text: event.target.value, edited: true })}
      />
      {item.kind === "amenities" ? (
        <span className="field-hint" id={ids.hint}>
          {t("amenitiesHint")}
        </span>
      ) : null}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={item.keep}
          onChange={(event) => onChange({ ...item, keep: event.target.checked })}
        />
        {t("keep")}
      </label>
    </section>
  );
}
