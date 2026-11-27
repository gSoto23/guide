"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  GuideView,
  InterviewQuestion,
  InterviewTurnView,
  InterviewView,
  MediaView,
} from "@guidesk/contracts";
import { problemOf, problemString } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import { InterviewCodeField } from "./interview-code-field";
import { MediaUploadButton } from "./media-upload";
import { VoiceRecorder } from "./voice-recorder";

const POLL_MS = 3_000;
/** Polling stops this long after the last answer; the drafts still land in the guide. */
const POLL_FOR_MS = 180_000;
const IN_FLIGHT = new Set(["queued", "transcribing", "drafting"]);
/** How many of the session's answers the list shows, newest first. */
const LISTED = 8;
/** Every kind a code typed in an answer could be (feature 020 FR-002). */
const ALL_CODE_KINDS = [
  "door_code",
  "gate_code",
  "lockbox_code",
  "alarm_code",
  "wifi_password",
  "other",
] as const;
/** The arrival code question accepts any entry code (feature 020, US1 scenario 2). */
const ENTRY_CODE_KINDS = ["door_code", "gate_code", "lockbox_code"] as const;

const hasRedactions = (turn: InterviewTurnView) =>
  Object.values(turn.redactions).some((count) => count > 0);

/**
 * The AI interview (screen H-14, features 003 US4, 020, 022): it asks only what the guide is
 * missing, one question per screen with the number left and a fixed "Save and continue" bar. An
 * answer is drafted in the background while the next question shows; the session's answers list
 * their state, and a failed one can be answered again. Code questions save a protected field right
 * there, a code typed in an answer is offered for saving before moving on, and photo or video
 * questions offer an attach button. The session resumes on any device.
 */
export function Interview({
  locale,
  propertyId,
  sectionKind,
}: {
  locale: string;
  propertyId: string;
  sectionKind?: string;
}) {
  const t = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [view, setView] = useState<InterviewView | null>(null);
  /** The question on screen: it changes only when the host acts, never while they type. */
  const [current, setCurrent] = useState<InterviewQuestion | null>(null);
  const [busyElsewhere, setBusyElsewhere] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  /** A code was removed from an answer: offer to save it before the next question (FR-005). */
  const [codeStep, setCodeStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Questions answered or skipped on this screen, for the progress bar. */
  const [handled, setHandled] = useState(0);
  const [lastAnswerAt, setLastAnswerAt] = useState(0);
  const base = `/properties/${propertyId}/guide`;
  const sessionRef = useRef<string | null>(null);

  const show = useCallback((loaded: InterviewView) => {
    sessionRef.current = loaded.sessionId;
    setView(loaded);
    setCurrent(loaded.question);
  }, []);

  useEffect(() => {
    if (!workspace) return;
    workspace.api
      .post<InterviewView>(`${base}/interview`, sectionKind ? { sectionKind } : {})
      .then(show)
      .catch(async (caught: unknown) => {
        const problem = problemOf(caught);
        const sessionId = problemString(problem, "sessionId");
        if (problem?.code === "interview_active" && sessionId) {
          setBusyElsewhere(true);
          show(await workspace.api.get<InterviewView>(`${base}/interview/${sessionId}`));
        } else {
          setFailed(true);
        }
      });
  }, [workspace, base, sectionKind, show]);

  const load = useCallback(async () => {
    if (!workspace || !sessionRef.current) return null;
    const loaded = await workspace.api.get<InterviewView>(
      `${base}/interview/${sessionRef.current}`,
    );
    setView(loaded);
    return loaded;
  }, [workspace, base]);

  // Drafts are written in the background (FR-003): the list follows them for a while.
  const writing = view?.turns.some((turn) => IN_FLIGHT.has(turn.status)) ?? false;
  useEffect(() => {
    if (!writing || Date.now() - lastAnswerAt > POLL_FOR_MS) return;
    const timer = setTimeout(() => {
      void load()
        .then((loaded) => {
          // At the end screen a follow-up question that arrives is shown.
          if (loaded && !current && !codeStep) setCurrent(loaded.question);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [writing, view, lastAnswerAt, load, current, codeStep]);

  if (!workspace) return null;
  if (failed) return <p className="alert alert-error">{errors("internal_error")}</p>;
  if (!view) return <p className="working">{t("interview.queued")}</p>;

  const sectionName = (kind: string) => t(`sections.${kind}`);

  function failure(caught: unknown) {
    const code = problemOf(caught)?.code ?? "internal_error";
    setError(errors.has(code) ? errors(code) : errors("internal_error"));
  }

  /** Shows the next question from the server, after an answer, a skip, a code, or a file. */
  async function advance() {
    setCodeStep(null);
    setHandled((count) => count + 1);
    const loaded = await load();
    setCurrent(loaded?.question ?? null);
  }

  async function submitted(started: InterviewTurnView, section: string) {
    setLastAnswerAt(Date.now());
    if (hasRedactions(started)) {
      setHandled((count) => count + 1);
      setCodeStep(section);
      await load();
      return;
    }
    await advance();
  }

  async function sendText(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !current || !text.trim() || sending) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const started = await workspace.api.post<InterviewTurnView>(
        `${base}/interview/${view!.sessionId}/answers`,
        { topicId: current.topicId, text: text.trim() },
      );
      setText("");
      await submitted(started, current.sectionKind);
    } catch (caught) {
      failure(caught);
    } finally {
      setSending(false);
    }
  }

  async function sendVoice(blob: Blob) {
    if (!workspace || !current) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const form = await workspace.api.post<{
        uploadId: string;
        url: string;
        fields: Record<string, string>;
      }>(`${base}/interview/${view!.sessionId}/voice`, { contentType: blob.type, size: blob.size });
      const body = new FormData();
      for (const [name, value] of Object.entries(form.fields)) body.append(name, value);
      body.append("file", blob, "voice-note");
      const uploaded = await fetch(form.url, { method: "POST", body });
      if (!uploaded.ok) throw new Error("upload failed");
      const started = await workspace.api.post<InterviewTurnView>(
        `${base}/interview/${view!.sessionId}/answers`,
        { topicId: current.topicId, voiceUploadId: form.uploadId },
      );
      await submitted(started, current.sectionKind);
    } catch (caught) {
      failure(caught);
    } finally {
      setSending(false);
    }
  }

  /** A file attached to a photo or video question goes to the end of its section (020 FR-006). */
  async function attach(media: MediaView) {
    if (!workspace || !current) return;
    try {
      const guide = await workspace.api.get<GuideView>(base);
      const section = guide.sections.find((entry) => entry.kind === current.sectionKind);
      if (!section) return;
      await workspace.api.post(
        `${base}/sections/${section.id}/items`,
        {
          revision: section.revision,
          kind: media.kind,
          language: guide.mainLanguage,
          mediaId: media.id,
        },
        { idempotent: true },
      );
      setNotice(t("interview.attached", { section: sectionName(current.sectionKind) }));
      await advance();
    } catch (caught) {
      failure(caught);
    }
  }

  async function codeSaved() {
    setNotice(t("interview.codeSaved"));
    if (codeStep) {
      setCodeStep(null);
      const loaded = await load();
      setCurrent(loaded?.question ?? null);
      return;
    }
    await advance();
  }

  async function skip() {
    if (!workspace || !current) return;
    setError(null);
    setNotice(null);
    try {
      const skipped = await workspace.api.post<InterviewView>(
        `${base}/interview/${view!.sessionId}/skip`,
        { topicId: current.topicId },
      );
      setHandled((count) => count + 1);
      setView(skipped);
      setCurrent(skipped.question);
    } catch (caught) {
      failure(caught);
    }
  }

  async function finish() {
    if (!workspace) return;
    try {
      const finished = await workspace.api.post<InterviewView>(
        `${base}/interview/${view!.sessionId}/finish`,
      );
      setView(finished);
      setCurrent(null);
    } catch (caught) {
      failure(caught);
    }
  }

  /** "Answer again" asks a failed answer's question once more (FR-004). */
  function retry(turn: InterviewTurnView) {
    if (!turn.sectionKind) return;
    setError(null);
    setNotice(null);
    setCodeStep(null);
    setText("");
    setCurrent({ topicId: turn.topicId, sectionKind: turn.sectionKind });
  }

  const added = view.turns.filter((turn) => turn.status === "done" && turn.itemIds.length > 0);
  const stillWriting = view.turns.filter((turn) => IN_FLIGHT.has(turn.status)).length;
  const listed = [...view.turns].reverse().slice(0, LISTED);
  const total = handled + view.remaining;
  const isText = Boolean(current && !current.opensLockedField && !current.asksMedia);

  const turnState = (turn: InterviewTurnView) =>
    IN_FLIGHT.has(turn.status)
      ? t("interview.stateWriting")
      : turn.status === "failed"
        ? t(`interview.error_${turn.errorCode ?? "not_understood"}`)
        : t("interview.stateDone");

  return (
    <section aria-labelledby="interview-title" className="interview">
      <p>
        <Link className="back-link" href={`/${locale}${base}`}>
          {t("editor.backToGuide")}
        </Link>
      </p>
      <h1 id="interview-title">{t("interview.title")}</h1>
      <p className="muted">{t("interview.intro")}</p>
      {busyElsewhere && <p className="alert alert-info">{t("interview.busyElsewhere")}</p>}
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert alert-success" role="status">
          {notice}
        </p>
      )}

      {view.status === "finished" ? (
        <div className="card">
          <p>{t("interview.finished")}</p>
          <p>
            <Link className="button button-primary" href={`/${locale}${base}`}>
              {t("interview.reviewGuide")}
            </Link>
          </p>
        </div>
      ) : codeStep ? (
        <div className="card interview-question">
          <h2>{t("interview.codeFoundTitle")}</h2>
          <p>{t("interview.redacted")}</p>
          <InterviewCodeField
            propertyId={propertyId}
            sectionKind={codeStep}
            kinds={[...ALL_CODE_KINDS]}
            onSaved={codeSaved}
          />
          <div className="interview-bar">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setCodeStep(null);
                setCurrent(view.question);
              }}
            >
              {t("interview.continueWithout")}
            </button>
          </div>
        </div>
      ) : !current ? (
        <div className="card interview-question">
          <h2>{t("interview.endTitle")}</h2>
          <p>{t("interview.endBody", { count: added.length })}</p>
          {stillWriting > 0 && (
            <p className="working">{t("interview.stillWriting", { count: stillWriting })}</p>
          )}
          <div className="actions">
            <Link className="button button-primary" href={`/${locale}${base}`}>
              {t("interview.reviewGuide")}
            </Link>
            <button type="button" className="button button-secondary" onClick={() => void finish()}>
              {t("interview.finish")}
            </button>
          </div>
        </div>
      ) : (
        <div className="card interview-question">
          <div className="interview-progress">
            <p className="interview-progress-head">
              <span className="muted">
                {t("interview.section", { section: sectionName(current.sectionKind) })}
                {" · "}
                {t("interview.remaining", { count: view.remaining })}
              </span>
              <button type="button" className="button-link" onClick={() => void finish()}>
                {t("interview.finish")}
              </button>
            </p>
            {total > 0 && (
              <progress
                value={handled}
                max={total}
                aria-label={t("interview.remaining", { count: view.remaining })}
              />
            )}
          </div>
          {current.opensLockedField ? (
            <>
              <h2>{t(`topics.${current.topicId}.name`)}</h2>
              <p>{t("interview.lockedTopic")}</p>
              <InterviewCodeField
                key={current.topicId}
                propertyId={propertyId}
                sectionKind={current.sectionKind}
                kinds={
                  current.topicId === "arrival.access_code"
                    ? [...ENTRY_CODE_KINDS]
                    : [current.opensLockedField]
                }
                onSaved={codeSaved}
              />
            </>
          ) : current.asksMedia ? (
            <>
              <h2>{t(`topics.${current.topicId}.question`)}</h2>
              <p className="field-hint">{t("interview.attachHint")}</p>
              <div className="actions">
                {current.asksMedia.map((kind) => (
                  <MediaUploadButton
                    key={kind}
                    propertyId={propertyId}
                    kind={kind}
                    label={kind === "image" ? t("editor.addPhoto") : t("editor.addVideo")}
                    onReady={attach}
                  />
                ))}
              </div>
            </>
          ) : (
            <form id="interview-form" onSubmit={sendText}>
              <h2>
                <label htmlFor="interview-answer">
                  {current.followUp ?? t(`topics.${current.topicId}.question`)}
                </label>
              </h2>
              <p className="field-hint">{t("interview.reminder")}</p>
              <textarea
                key={current.topicId}
                id="interview-answer"
                value={text}
                maxLength={2000}
                rows={5}
                disabled={sending}
                onChange={(event) => setText(event.target.value)}
              />
              {view.voiceEnabled && (
                <>
                  <p className="muted">{t("interview.orRecord")}</p>
                  <VoiceRecorder disabled={sending} onRecorded={sendVoice} />
                </>
              )}
            </form>
          )}
          <div className={isText ? "interview-bar is-fixed" : "interview-bar"}>
            {isText && (
              <button
                type="submit"
                form="interview-form"
                className="button button-primary"
                disabled={sending || !text.trim()}
              >
                {sending ? t("interview.sending") : t("interview.saveNext")}
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              disabled={sending}
              onClick={() => void skip()}
            >
              {t("interview.skip")}
            </button>
          </div>
        </div>
      )}

      {listed.length > 0 && (
        <section aria-labelledby="interview-answers" className="interview-answers">
          <h2 id="interview-answers">{t("interview.answers")}</h2>
          <ul aria-live="polite">
            {listed.map((turn) => (
              <li key={turn.id} className={`interview-answer interview-answer-${turn.status}`}>
                <span>{t(`topics.${turn.topicId}.name`)}</span>
                <span className="muted">{turnState(turn)}</span>
                {turn.status === "failed" && turn.sectionKind ? (
                  <button type="button" className="button-link" onClick={() => retry(turn)}>
                    {t("interview.retry")}
                  </button>
                ) : null}
                {turn.status === "done" && turn.answerKind === "voice" && hasRedactions(turn) ? (
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => setCodeStep(turn.sectionKind ?? "arrival")}
                  >
                    {t("interview.saveCode")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
