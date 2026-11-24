"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { GuideView, InterviewTurnView, InterviewView, ItemView } from "@guidesk/contracts";
import { GuideDocumentView, type RenderableDocument } from "@guidesk/ui";
import { problemOf, problemString } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import { VoiceRecorder } from "./voice-recorder";

const POLL_MS = 2_000;
const GIVE_UP_MS = 60_000;
const IN_FLIGHT = new Set(["queued", "transcribing", "drafting"]);

/**
 * The AI interview (screen H-14, feature 003 US4): one catalog question at a time for the topics
 * guests ask about most (FR-034), answered by text or voice note (FR-035, FR-037), drafted into
 * unreviewed items the host reviews; code topics open the locked fields instead (FR-038). The
 * session resumes on any device.
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
  const [busyElsewhere, setBusyElsewhere] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [turn, setTurn] = useState<InterviewTurnView | null>(null);
  const [drafted, setDrafted] = useState<ItemView[]>([]);
  /** The section of the question the last answer was for. */
  const [turnSection, setTurnSection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const base = `/properties/${propertyId}/guide`;
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    workspace.api
      .post<InterviewView>(`${base}/interview`, sectionKind ? { sectionKind } : {})
      .then((loaded) => {
        sessionRef.current = loaded.sessionId;
        setView(loaded);
      })
      .catch(async (caught: unknown) => {
        const problem = problemOf(caught);
        const sessionId = problemString(problem, "sessionId");
        if (problem?.code === "interview_active" && sessionId) {
          sessionRef.current = sessionId;
          setBusyElsewhere(true);
          setView(await workspace.api.get<InterviewView>(`${base}/interview/${sessionId}`));
        } else {
          setFailed(true);
        }
      });
  }, [workspace, base, sectionKind]);

  const refresh = useCallback(async () => {
    if (!workspace || !sessionRef.current) return;
    setView(await workspace.api.get<InterviewView>(`${base}/interview/${sessionRef.current}`));
  }, [workspace, base]);

  /** Polls a turn every 2 seconds until it is drafted or fails (research R11). */
  const follow = useCallback(
    async (started: InterviewTurnView) => {
      if (!workspace || !sessionRef.current) return;
      let current = started;
      setTurn(current);
      const begin = Date.now();
      while (IN_FLIGHT.has(current.status) && Date.now() - begin < GIVE_UP_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        current = await workspace.api.get<InterviewTurnView>(
          `${base}/interview/${sessionRef.current}/turns/${current.id}`,
        );
        setTurn(current);
      }
      if (current.status === "done" && current.itemIds.length > 0) {
        const guide = await workspace.api.get<GuideView>(base);
        const ids = new Set(current.itemIds);
        setDrafted(
          guide.sections.flatMap((section) => section.items).filter((item) => ids.has(item.id)),
        );
      }
      await refresh();
    },
    [workspace, base, refresh],
  );

  if (!workspace) return null;
  if (failed) return <p className="alert alert-error">{errors("internal_error")}</p>;
  if (!view) return <p className="working">{t("interview.queued")}</p>;

  const question = view.question;
  const sectionName = (kind: string) => t(`sections.${kind}`);
  const inFlight = turn !== null && IN_FLIGHT.has(turn.status);

  function failure(caught: unknown) {
    const code = problemOf(caught)?.code ?? "internal_error";
    setError(errors.has(code) ? errors(code) : errors("internal_error"));
  }

  async function sendText(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !question || !text.trim()) return;
    setSending(true);
    setError(null);
    setDrafted([]);
    setTurnSection(question.sectionKind);
    try {
      const started = await workspace.api.post<InterviewTurnView>(
        `${base}/interview/${view!.sessionId}/answers`,
        { topicId: question.topicId, text: text.trim() },
      );
      setText("");
      await follow(started);
    } catch (caught) {
      failure(caught);
    } finally {
      setSending(false);
    }
  }

  async function sendVoice(blob: Blob) {
    if (!workspace || !question) return;
    setSending(true);
    setError(null);
    setDrafted([]);
    setTurnSection(question.sectionKind);
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
        { topicId: question.topicId, voiceUploadId: form.uploadId },
      );
      await follow(started);
    } catch (caught) {
      failure(caught);
    } finally {
      setSending(false);
    }
  }

  async function skip() {
    if (!workspace || !question) return;
    setError(null);
    setTurn(null);
    setDrafted([]);
    try {
      setView(
        await workspace.api.post<InterviewView>(`${base}/interview/${view!.sessionId}/skip`, {
          topicId: question.topicId,
        }),
      );
    } catch (caught) {
      failure(caught);
    }
  }

  async function finish() {
    if (!workspace) return;
    try {
      setView(
        await workspace.api.post<InterviewView>(`${base}/interview/${view!.sessionId}/finish`),
      );
    } catch (caught) {
      failure(caught);
    }
  }

  const redacted = turn && Object.values(turn.redactions).some((count) => count > 0);

  return (
    <section aria-labelledby="interview-title">
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

      {turn && (
        <div className="card" aria-live="polite">
          {turn.status === "queued" && <p className="working">{t("interview.queued")}</p>}
          {turn.status === "transcribing" && (
            <p className="working">{t("interview.transcribing")}</p>
          )}
          {turn.status === "drafting" && <p className="working">{t("interview.drafting")}</p>}
          {turn.status === "failed" && (
            <p className="alert alert-error">
              {t(`interview.error_${turn.errorCode ?? "not_understood"}`)}
            </p>
          )}
          {redacted && <p className="alert alert-info">{t("interview.redacted")}</p>}
          {turn.transcript && (
            <>
              <h2>{t("interview.transcript")}</h2>
              <blockquote>{turn.transcript}</blockquote>
            </>
          )}
          {turn.status === "done" && (
            <>
              <p>
                {t("interview.done", {
                  count: turn.itemIds.length,
                  section: turnSection ? sectionName(turnSection) : "",
                })}
              </p>
              {drafted.length > 0 && <h2>{t("interview.drafted")}</h2>}
              {drafted.map((item) => (
                <GuideDocumentView
                  key={item.id}
                  doc={item.texts[item.sourceLanguage]?.doc as RenderableDocument | null}
                  renderLockedField={() => `🔒 ${t("editor.lockedField")}`}
                />
              ))}
            </>
          )}
        </div>
      )}

      {view.status === "finished" ? (
        <p className="alert alert-info">{t("interview.finished")}</p>
      ) : !question ? (
        <p className="alert alert-info">{t("interview.noMore")}</p>
      ) : (
        <div className="card">
          <p className="muted">
            {t("interview.section", { section: sectionName(question.sectionKind) })}
          </p>
          {question.opensLockedField ? (
            <>
              <h2>{t(`topics.${question.topicId}.name`)}</h2>
              <p>{t("interview.lockedTopic")}</p>
              <Link className="button button-primary" href={`/${locale}${base}/locked-fields`}>
                🔒 {t("interview.openLocked")}
              </Link>
            </>
          ) : (
            <form onSubmit={sendText}>
              <h2>
                <label htmlFor="interview-answer">
                  {question.followUp ?? t(`topics.${question.topicId}.question`)}
                </label>
              </h2>
              <p className="field-hint">{t("interview.reminder")}</p>
              <textarea
                id="interview-answer"
                aria-label={t("interview.answerLabel")}
                value={text}
                maxLength={2000}
                rows={4}
                disabled={sending || inFlight}
                onChange={(event) => setText(event.target.value)}
              />
              <div className="actions">
                <button
                  type="submit"
                  className="button button-primary"
                  disabled={sending || inFlight || !text.trim()}
                >
                  {sending ? t("interview.sending") : t("interview.send")}
                </button>
              </div>
              {view.voiceEnabled && (
                <>
                  <p className="muted">{t("interview.orRecord")}</p>
                  <VoiceRecorder disabled={sending || inFlight} onRecorded={sendVoice} />
                </>
              )}
            </form>
          )}
          <div className="actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={sending || inFlight}
              onClick={() => void skip()}
            >
              {t("interview.skip")}
            </button>
            <button type="button" className="button button-secondary" onClick={() => void finish()}>
              {t("interview.finish")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
