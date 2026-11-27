import { createRequire } from "node:module";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import {
  guide,
  guideItem,
  guideItemText,
  guideSection,
  interviewSession,
  interviewTurn,
  property,
  upload,
  type Database,
} from "@guidesk/db";
import {
  docFromPlainText,
  docPlainText,
  GUIDE_TOPICS,
  guideTopic,
  isMediaOnlyTopic,
  JOB_QUEUES,
  mainLanguage,
  redactRestrictedValues,
  stripUnknownLinks,
  validTopicIds,
  type InterviewAnswerJob,
} from "@guidesk/domain";
import {
  LlmTimeoutError,
  LlmUnavailableError,
  type GuideLlmPort,
  type ObjectStoragePort,
  type SandboxPort,
  type SpeechToTextPort,
} from "@guidesk/integrations";
import { recordGuideAi } from "./guide-ai.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * An interview answer (feature 003 US4, research R8, R11): a voice note is checked by the file
 * processor, transcribed, and deleted (FR-037); the transcript or typed answer passes the
 * restricted-value detector; one `draftAnswer` call drafts unreviewed items labeled `interview`
 * in the topic's section, in the guide's main language, and may store one follow-up question.
 * The API took the request from the daily AI limit before queueing it (FR-064).
 */
export interface InterviewAnswerDeps {
  db: Database;
  llm: GuideLlmPort;
  speech: SpeechToTextPort;
  sandbox: SandboxPort;
  storage: ObjectStoragePort;
  span?: JobSpanDeps;
  /** Overrides the 25-second drafting limit (tests). */
  draftTimeoutMs?: number;
}

/** Text answers have 15 seconds in all and voice answers 30 (FR-036); the model gets 25. */
const DRAFT_TIMEOUT_MS = 25_000;

export type InterviewAnswerOutcome =
  | "drafted"
  | "not_understood"
  | "transcription_failed"
  | "unsupported_type"
  | "ai_unavailable"
  | "skipped";

/** Thrown while the turn is not visible yet (its request is still committing), so pg-boss retries. */
export class TurnNotReadyError extends Error {
  constructor() {
    super("interview turn not ready");
  }
}

const TOPIC_HINTS = GUIDE_TOPICS.map((topic) => ({ id: topic.id, sectionKind: topic.section }));

const require = createRequire(import.meta.url);
type Catalog = { guide: { topics: Record<string, { question?: string }> } };
const CATALOGS: Record<"es" | "en", Catalog> = {
  es: require("@guidesk/i18n/messages/es.json") as Catalog,
  en: require("@guidesk/i18n/messages/en.json") as Catalog,
};

/** The catalog question the host saw (R11). */
export function catalogQuestion(topicId: string, language: "es" | "en"): string {
  return CATALOGS[language].guide.topics[topicId]?.question ?? topicId;
}

export async function runInterviewAnswer(
  deps: InterviewAnswerDeps,
  job: InterviewAnswerJob,
): Promise<InterviewAnswerOutcome> {
  const { db } = deps;
  const [row] = await db
    .select({
      turn: interviewTurn,
      guideId: interviewSession.guideId,
      languages: property.guideLanguages,
    })
    .from(interviewTurn)
    .innerJoin(interviewSession, eq(interviewSession.id, interviewTurn.sessionId))
    .innerJoin(guide, eq(guide.id, interviewSession.guideId))
    .innerJoin(property, eq(property.id, guide.propertyId))
    .where(and(eq(interviewTurn.id, job.turnId), eq(interviewTurn.workspaceId, job.workspaceId)))
    .limit(1);
  if (!row) throw new TurnNotReadyError();
  const { turn } = row;
  if (turn.status !== "queued") return "skipped";
  const finishWith = async (
    outcome: Exclude<InterviewAnswerOutcome, "drafted" | "skipped">,
  ): Promise<InterviewAnswerOutcome> => {
    await fail(db, turn.id, outcome);
    return outcome;
  };
  const topic = guideTopic(turn.topicId);
  if (!topic) return finishWith("not_understood");
  const language = mainLanguage(row.languages);

  // 1. The answer's text: typed (already through the detector in the API) or transcribed.
  let answer = turn.answerText ?? "";
  if (turn.answerKind === "voice") {
    await setStatus(db, turn.id, "transcribing");
    const [voice] = turn.uploadId
      ? await db
          .select({ objectKey: upload.objectKey, declaredType: upload.declaredType })
          .from(upload)
          .where(eq(upload.id, turn.uploadId))
          .limit(1)
      : [];
    if (!voice) return finishWith("transcription_failed");
    const checked = await deps.sandbox.processFile({
      objectKey: voice.objectKey,
      purpose: "audio",
    });
    if ("error" in checked) {
      return finishWith(
        checked.error === "not_found" ? "transcription_failed" : "unsupported_type",
      );
    }
    let transcript;
    try {
      transcript = await deps.speech.transcribe({
        objectKey: voice.objectKey,
        jobName: turn.id,
        contentType: voice.declaredType,
      });
    } finally {
      // The recording is deleted once it is transcribed, or failed to be (FR-037).
      await deps.storage.delete(voice.objectKey).catch(() => undefined);
    }
    if (transcript.outcome === "failed") return finishWith("transcription_failed");
    if (transcript.outcome === "empty" || !transcript.text?.trim()) {
      return finishWith("not_understood");
    }
    const redacted = redactRestrictedValues(transcript.text);
    answer = redacted.text;
    await db
      .update(interviewTurn)
      .set({ transcript: redacted.text, redactions: redacted.counts as Record<string, number> })
      .where(eq(interviewTurn.id, turn.id));
  }
  if (!answer.trim()) return finishWith("not_understood");

  // 2. The question as the host saw it: the catalog's, or the model's follow-up (R11).
  const [previous] = await db
    .select({ followUp: interviewTurn.followUp })
    .from(interviewTurn)
    .where(
      and(
        eq(interviewTurn.sessionId, turn.sessionId),
        eq(interviewTurn.topicId, turn.topicId),
        eq(interviewTurn.status, "done"),
        lt(interviewTurn.createdAt, turn.createdAt),
      ),
    )
    .orderBy(desc(interviewTurn.createdAt))
    .limit(1);
  const question = previous?.followUp ?? catalogQuestion(topic.id, language);

  // 3. The draft.
  await setStatus(db, turn.id, "drafting");
  let result;
  try {
    result = await deps.llm.draftAnswer(
      {
        language,
        topicId: topic.id,
        sectionKind: topic.section,
        question,
        answer,
        topics: TOPIC_HINTS,
      },
      { signal: AbortSignal.timeout(deps.draftTimeoutMs ?? DRAFT_TIMEOUT_MS) },
    );
  } catch (error: unknown) {
    if (error instanceof LlmTimeoutError || error instanceof LlmUnavailableError) {
      await recordGuideAi(db, {
        workspaceId: job.workspaceId,
        guideId: row.guideId,
        kind: "interview_answer",
        outcome: error instanceof LlmTimeoutError ? "timeout" : "unavailable",
      });
      return finishWith("ai_unavailable");
    }
    throw error;
  }
  await recordGuideAi(db, {
    workspaceId: job.workspaceId,
    guideId: row.guideId,
    kind: "interview_answer",
    result,
  });
  if (result.outcome !== "ok" || !result.result) return finishWith("not_understood");

  // A second line of defense: the detector runs on the output too (research R5).
  const drafted = result.result.items
    .map((item) => ({
      text: redactRestrictedValues(stripUnknownLinks(item.text, answer)).text.trim(),
      // Feature 020 FR-006: text never covers a photo or video topic.
      topics: validTopicIds([topic.id, ...item.topics]).filter(
        (id) => !isMediaOnlyTopic(guideTopic(id) ?? { rules: [] }),
      ),
    }))
    .filter((item) => item.text);
  if (drafted.length === 0) return finishWith("not_understood");
  const followUp = result.result.followUp
    ? redactRestrictedValues(result.result.followUp).text.trim().slice(0, 300) || null
    : null;

  // 4. Unreviewed items in the topic's section, and the turn done, in one transaction.
  await db.transaction(async (tx) => {
    const [section] = await tx
      .select({ id: guideSection.id })
      .from(guideSection)
      .where(and(eq(guideSection.guideId, row.guideId), eq(guideSection.kind, topic.section)))
      .limit(1);
    if (!section) throw new Error("guide section missing");
    const [{ next } = { next: 0 }] = await tx
      .select({ next: sql<number>`coalesce(max(${guideItem.position}) + 1, 0)::int` })
      .from(guideItem)
      .where(eq(guideItem.sectionId, section.id));
    for (const [index, entry] of drafted.entries()) {
      const doc = docFromPlainText(entry.text);
      const [item] = await tx
        .insert(guideItem)
        .values({
          workspaceId: job.workspaceId,
          sectionId: section.id,
          kind: "text",
          position: next + index,
          source: "interview",
          sourceLanguage: language,
          topics: entry.topics,
          interviewTurnId: turn.id,
        })
        .returning({ id: guideItem.id });
      await tx.insert(guideItemText).values({
        itemId: item!.id,
        language,
        workspaceId: job.workspaceId,
        doc,
        textLength: docPlainText(doc).replace(/\n/g, "").length,
        origin: "source",
        state: "current",
      });
    }
    await tx
      .update(guideSection)
      .set({ revision: sql`${guideSection.revision} + 1` })
      .where(eq(guideSection.id, section.id));
    // A guide that was ever published now differs from what guests read (FR-053).
    await tx
      .update(guide)
      .set({ hasUnpublishedChanges: sql`${guide.status} <> 'draft'` })
      .where(eq(guide.id, row.guideId));
    await tx
      .update(interviewTurn)
      .set({ status: "done", followUp, errorCode: null, completedAt: new Date() })
      .where(eq(interviewTurn.id, turn.id));
  });
  return "drafted";
}

async function setStatus(
  db: Database,
  turnId: string,
  status: "transcribing" | "drafting",
): Promise<void> {
  await db.update(interviewTurn).set({ status }).where(eq(interviewTurn.id, turnId));
}

/** Ends a turn with an error the host can act on; the question stays open (FR-037). */
async function fail(db: Database, turnId: string, errorCode: string): Promise<void> {
  await db
    .update(interviewTurn)
    .set({ status: "failed", errorCode, completedAt: new Date() })
    .where(eq(interviewTurn.id, turnId));
}

/** The pg-boss handler: one span per job (constitution VIII), outcome only, never content. */
export function createInterviewAnswerHandler(deps: InterviewAnswerDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<InterviewAnswerJob>;
      if (typeof data.turnId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload: InterviewAnswerJob = { workspaceId: data.workspaceId, turnId: data.turnId };
      await runInJobSpan(
        { queue: JOB_QUEUES.interviewAnswer, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await runInterviewAnswer(deps, payload);
          span.set({ "job.outcome": outcome });
          if (outcome !== "drafted" && outcome !== "skipped") span.recordFailure(outcome);
        },
        deps.span,
      );
    }
  };
}
