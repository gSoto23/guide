"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { AssistantTest } from "@guidesk/contracts";
import { TEST_QUESTION_MAX as ASSISTANT_TEST_QUESTION_MAX } from "@/lib/assistant";
import { problemNumber, problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

const POLL_MS = 1000;
const GIVE_UP_MS = 20_000;

/**
 * "Test the assistant" (feature 007 US5, FR-018): a member asks a question the way a guest would
 * and sees the topic, what would happen under the saved settings, and the text, without anything
 * reaching a guest. The run happens in the worker; the panel polls for the result.
 */
export function AssistantTestPanel({
  locale,
  propertyId,
  hasPublishedGuide,
}: {
  locale: string;
  propertyId: string;
  hasPublishedGuide: boolean;
}) {
  const t = useTranslations("assistant.test");
  const kinds = useTranslations("assistant.kinds");
  const topics = useTranslations("assistant.autonomy.topics");
  const reasons = useTranslations("conversations.reasons");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const id = useId();
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AssistantTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    // Set on every mount: React's development double mount runs the cleanup once in between.
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  if (!workspace) return null;
  const base = `/properties/${propertyId}/assistant/tests`;

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !question.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const { id: testId } = await workspace.api.post<{ id: string }>(base, {
        question: question.trim(),
        language: locale === "en" ? "en" : "es",
      });
      const started = Date.now();
      while (!cancelled.current && Date.now() - started < GIVE_UP_MS) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        const current = await workspace.api.get<AssistantTest>(`${base}/${testId}`);
        if (current.status === "done") {
          setResult(current);
          return;
        }
      }
      if (!cancelled.current) setError(t("timeout"));
    } catch (cause) {
      const problem = problemOf(cause);
      if (problem?.code === "tests_paused") {
        const seconds = problemNumber(problem, "retryAfterSeconds") ?? 3600;
        setError(t("paused", { minutes: Math.max(1, Math.ceil(seconds / 60)) }));
      } else if (problem?.code === "guide_not_published") {
        setError(t("notPublished"));
      } else {
        setError(errors("internal_error"));
      }
    } finally {
      setRunning(false);
    }
  }

  const topicLabel = (topic: string) =>
    topics.has(topic as "other") ? topics(topic as "other") : topic;

  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("title")}</h2>
      <p className="muted">{t("body")}</p>
      {!hasPublishedGuide ? (
        <p className="muted">{t("notPublished")}</p>
      ) : (
        <form onSubmit={(event) => void run(event)} noValidate>
          <label htmlFor={`${id}-question`}>{t("label")}</label>
          <textarea
            id={`${id}-question`}
            rows={2}
            maxLength={ASSISTANT_TEST_QUESTION_MAX}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
          />
          <div className="actions">
            <button
              type="submit"
              className="button button-secondary"
              disabled={running || !question.trim()}
            >
              {running ? t("running") : t("submit")}
            </button>
          </div>
        </form>
      )}
      <div aria-live="polite">
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {result?.outcome && (
          <div className="test-result">
            <p>
              <strong>{t("outcome", { outcome: t(`outcomes.${result.outcome}`) })}</strong>
            </p>
            <ul className="why-list">
              {result.topic && <li>{t("topic", { topic: topicLabel(result.topic) })}</li>}
              {result.reason && <li>{t("reason", { reason: reasons(result.reason) })}</li>}
              {result.answerKind && <li>{t("kind", { kind: kinds(result.answerKind) })}</li>}
            </ul>
            {result.reply && (
              <>
                <p className="muted">{t("reply")}</p>
                <p className="transcript-text">{result.reply}</p>
              </>
            )}
            {result.sections.length > 0 && (
              <p className="muted">
                {t("sources")} {result.sections.map((section) => section.title).join(", ")}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
