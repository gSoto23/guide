"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { ConversationDetail, MemberChatMessage, MemberTrace } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

const REFRESH_MS = 10_000;
const MAX = 2000;

/**
 * The conversation page (feature 005 US3, H-21 subset, FR-024 to FR-027, FR-031): every message as
 * plain text, the assistant's open draft with its sources, Send and Edit, a reply box with the
 * output checks as warnings (PC-14), and "Why this reply" from the member trace.
 */
export function ConversationView({
  locale,
  propertyId,
  conversationId,
}: {
  locale: string;
  propertyId: string;
  conversationId: string;
}) {
  const t = useTranslations("conversations");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const base = `/properties/${propertyId}/conversations/${conversationId}`;

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setDetail(await workspace.api.get<ConversationDetail>(base));
    } catch (cause) {
      setMessage({
        kind: "error",
        text: errors(problemOf(cause)?.code === "not_found" ? "not_found" : "internal_error"),
      });
    }
  }, [workspace, base, errors]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!workspace || !detail) {
    return message ? (
      <p className="alert alert-error" role="alert">
        {message.text}
      </p>
    ) : null;
  }

  const tracesByMessage = new Map(
    detail.traces.filter((trace) => trace.messageId).map((trace) => [trace.messageId!, trace]),
  );
  const draftTrace = detail.draft?.traceId
    ? detail.traces.find((trace) => trace.id === detail.draft!.traceId)
    : undefined;

  /** Posts, asking once to confirm when the API returns warnings (PC-14). */
  async function post(path: string, body: Record<string, unknown>): Promise<boolean> {
    if (!workspace) return false;
    setBusy(true);
    setMessage(null);
    try {
      try {
        await workspace.api.post<MemberChatMessage>(path, body);
      } catch (cause) {
        const problem = problemOf(cause);
        if (problem?.code !== "reply_warnings") throw cause;
        const warnings = Array.isArray(problem.warnings) ? (problem.warnings as string[]) : [];
        const text = [
          t("warnings.intro"),
          ...warnings.map((warning) => `• ${t(`warnings.${warning}`)}`),
          "",
          t("warnings.lockedNote"),
          t("warnings.confirm"),
        ].join("\n");
        if (!window.confirm(text)) return false;
        await workspace.api.post<MemberChatMessage>(path, { ...body, acknowledgeWarnings: true });
      }
      setMessage({ kind: "success", text: t("reply.sent") });
      await load();
      return true;
    } catch (cause) {
      const code = problemOf(cause)?.code;
      setMessage({
        kind: "error",
        text: code === "draft_closed" ? t("draft.closed") : errors("internal_error"),
      });
      if (code === "draft_closed") await load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendDraft(edited: boolean) {
    if (!detail?.draft) return;
    const ok = await post(
      `${base}/drafts/${detail.draft.id}/send`,
      edited ? { text: draftText.trim() } : {},
    );
    if (ok) setEditing(false);
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!reply.trim()) return;
    if (await post(`${base}/replies`, { text: reply.trim() })) setReply("");
  }

  const who = (item: MemberChatMessage) => {
    if (item.author === "guest") return t("you");
    if (item.author === "host") return t("hostName", { name: item.authorName ?? "" });
    return t("assistantName");
  };
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section aria-labelledby="conversation-title" className="conversation">
      <p>
        <Link href={`/${locale}/properties/${propertyId}/conversations`}>{t("backToList")}</Link>
      </p>
      <h1 id="conversation-title">{t("conversation")}</h1>
      <p className="property-meta">
        <span
          className={`badge ${detail.status === "needs_host" ? "badge-warning" : "badge-ready"}`}
        >
          {detail.status === "needs_host" ? t("needsHost") : t("open")}
        </span>
        <span className="badge">
          {detail.stay
            ? t("stayDates", {
                checkIn: detail.stay.checkInDate,
                checkout: detail.stay.checkoutDate,
              })
            : t("noStay")}
        </span>
      </p>
      {detail.reason && (
        <p className="muted">{t("reason", { reason: t(`reasons.${detail.reason}`) })}</p>
      )}
      {message && (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-success"}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      <button type="button" className="button button-secondary" onClick={() => void load()}>
        {t("refresh")}
      </button>

      <ol className="list-plain transcript" aria-label={t("conversation")}>
        {detail.messages.map((item) => {
          const trace = tracesByMessage.get(item.id);
          return (
            <li key={item.id} className={`card transcript-item transcript-${item.author}`}>
              <p className="muted transcript-meta">
                <strong>{who(item)}</strong> · {when(item.createdAt)}
              </p>
              {item.kind === "emergency" && (
                <p className="badge-warning badge">{t("emergencyCard")}</p>
              )}
              <p className="transcript-text">{item.body}</p>
              {item.sections.length > 0 && (
                <p className="muted">
                  {t("sources")} {item.sections.map((section) => section.title).join(", ")}
                </p>
              )}
              {item.author === "assistant" && item.authorName && (
                <p className="muted">{t("sentBy", { name: item.authorName })}</p>
              )}
              {trace && <Why trace={trace} />}
            </li>
          );
        })}
      </ol>

      {detail.draft && (
        <section className="card draft-card" aria-labelledby="draft-title">
          <h2 id="draft-title">{t("draft.title")}</h2>
          <p className="muted">{t("draft.body")}</p>
          {editing ? (
            <>
              <label htmlFor="draft-text" className="visually-hidden">
                {t("draft.title")}
              </label>
              <textarea
                id="draft-text"
                rows={5}
                maxLength={MAX}
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
              />
            </>
          ) : (
            <p className="transcript-text">{detail.draft.body}</p>
          )}
          {detail.draft.sections.length > 0 && (
            <p className="muted">
              {t("sources")} {detail.draft.sections.map((section) => section.title).join(", ")}
            </p>
          )}
          {draftTrace && <Why trace={draftTrace} />}
          {detail.canReply && (
            <div className="actions">
              {editing ? (
                <>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy || !draftText.trim()}
                    onClick={() => void sendDraft(true)}
                  >
                    {t("draft.sendEdited")}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setEditing(false)}
                  >
                    {t("draft.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy}
                    onClick={() => void sendDraft(false)}
                  >
                    {t("draft.send")}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => {
                      setDraftText(detail.draft!.body);
                      setEditing(true);
                    }}
                  >
                    {t("draft.edit")}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {detail.canReply ? (
        <form className="card" onSubmit={(event) => void sendReply(event)} noValidate>
          <h2>{t("reply.title")}</h2>
          <label htmlFor="reply-text">{t("reply.label")}</label>
          <textarea
            id="reply-text"
            rows={4}
            maxLength={MAX}
            value={reply}
            aria-describedby="reply-hint"
            onChange={(event) => setReply(event.target.value)}
          />
          <p id="reply-hint" className="muted">
            {t("reply.hint")}
          </p>
          <button type="submit" className="button button-primary" disabled={busy || !reply.trim()}>
            {t("reply.send")}
          </button>
        </form>
      ) : (
        <p className="muted">{t("readOnly")}</p>
      )}
    </section>
  );
}

/** "Why this reply" (FR-031): the member part of the trace, never model, tokens, or cost. */
function Why({ trace }: { trace: MemberTrace }) {
  const t = useTranslations("conversations.why");
  const kinds = useTranslations("assistant.kinds");
  return (
    <details className="issue-details">
      <summary>{t("title")}</summary>
      <ul className="why-list">
        <li>{t("decision", { decision: t(`decisions.${trace.decision}`) })}</li>
        {trace.topic && <li>{t("topic", { topic: trace.topic })}</li>}
        {trace.autonomySource ? (
          <li>
            {t("level", {
              level: t(`levels.${trace.autonomy}`),
              source: t(`sources.${trace.autonomySource}`),
            })}
          </li>
        ) : (
          <li>{t("autonomy", { autonomy: t(`levels.${trace.autonomy}`) })}</li>
        )}
        {trace.answerKind && <li>{t("kind", { kind: kinds(trace.answerKind) })}</li>}
        {trace.tone && <li>{t("tone", { tone: t(`tones.${trace.tone}`) })}</li>}
        {trace.quietHours && <li>{t("quietHours")}</li>}
        {(trace.instructions.workspace || trace.instructions.property) && (
          <li>
            {t("instructionsUsed", {
              which: t(
                `instructionScopes.${
                  trace.instructions.workspace && trace.instructions.property
                    ? "both"
                    : trace.instructions.workspace
                      ? "workspace"
                      : "property"
                }`,
              ),
            })}
          </li>
        )}
        {trace.guideVersion !== null && <li>{t("version", { version: trace.guideVersion })}</li>}
        {trace.edited && <li>{t("edited")}</li>}
      </ul>
      {trace.checks.length > 0 && (
        <>
          <p className="muted">{t("checks")}</p>
          <ul className="why-list">
            {trace.checks.map((check) => (
              <li key={check.check}>
                {t(`checkNames.${check.check}`)}: {check.passed ? t("passed") : t("failed")}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
