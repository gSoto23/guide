import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type {
  InterviewAnswerBody,
  InterviewQuestion,
  InterviewTurnView,
  InterviewView,
  InterviewVoiceBody,
  StartInterviewBody,
} from "@guidesk/contracts";
import { guideItem, interviewSession, interviewTurn, upload } from "@guidesk/db";
import {
  JOB_QUEUES,
  guideTopic,
  isMediaOnlyTopic,
  topicMediaKinds,
  redactRestrictedValues,
  type InterviewAnswerJob,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { RequestDb } from "../database/request-db.js";
import { GuideLimitsService } from "../guides/guide-limits.service.js";
import { GuideViewService, type Caller, type GuideContext } from "../guides/guide-view.service.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { UploadsService, type UploadForm } from "../uploads/uploads.service.js";

type SessionRow = typeof interviewSession.$inferSelect;
type TurnRow = typeof interviewTurn.$inferSelect;

const IN_FLIGHT = new Set(["queued", "transcribing", "drafting"]);

/**
 * The AI interview (feature 003 US4, research R11): catalog questions over the missing topics in
 * order of weight (FR-034), one follow-up per topic from the model, code topics that open the
 * locked-field form (FR-038), text or voice answers drafted by the `interview.answer` job, and
 * sessions that resume on any device (FR-035). Typed answers pass the restricted-value detector
 * before they are stored or sent anywhere (AC-SEC-004).
 */
@Injectable()
export class InterviewsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly views: GuideViewService,
    private readonly limits: GuideLimitsService,
    private readonly jobs: JobQueueService,
    private readonly uploads: UploadsService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  private get voiceEnabled(): boolean {
    return this.config.integrations.flags.guideInterviewVoice;
  }

  /**
   * Starts an interview, or returns the caller's active one (FR-034, FR-035), scoped to the section
   * asked for now, or to the whole guide when none (feature 020 FR-005).
   */
  async start(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    body: StartInterviewBody,
  ): Promise<InterviewView> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const existing = await this.activeOf(ctx);
    if (existing) return this.resume(ctx, caller, existing, body.sectionKind ?? null);
    // Two starts at once (a double tap, two tabs) meet on the one-active-session index.
    const [created] = await this.tx
      .insert(interviewSession)
      .values({
        workspaceId,
        guideId: ctx.guide.id,
        scopeSectionKind: body.sectionKind ?? null,
        startedBy: caller.userId,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return this.viewOf(ctx, created);
    const winner = await this.activeOf(ctx);
    if (!winner) throw new ApiProblem(409, "interview_active");
    return this.resume(ctx, caller, winner, body.sectionKind ?? null);
  }

  private async activeOf(ctx: GuideContext): Promise<SessionRow | undefined> {
    const [row] = await this.tx
      .select()
      .from(interviewSession)
      .where(and(eq(interviewSession.guideId, ctx.guide.id), eq(interviewSession.status, "active")))
      .limit(1);
    return row;
  }

  /** The caller's own active session resumes; someone else's answers 409 with its ID. */
  private async resume(
    ctx: GuideContext,
    caller: Caller,
    active: SessionRow,
    scope: SessionRow["scopeSectionKind"],
  ): Promise<InterviewView> {
    if (active.startedBy !== caller.userId) {
      throw new ApiProblem(409, "interview_active", undefined, {
        details: { sessionId: active.id },
      });
    }
    if (active.scopeSectionKind === scope) return this.viewOf(ctx, active);
    const [rescoped] = await this.tx
      .update(interviewSession)
      .set({ scopeSectionKind: scope })
      .where(eq(interviewSession.id, active.id))
      .returning();
    return this.viewOf(ctx, rescoped ?? active);
  }

  async get(workspaceId: string, propertyId: string, sessionId: string): Promise<InterviewView> {
    const ctx = await this.views.load(workspaceId, propertyId);
    return this.viewOf(ctx, await this.session(ctx, sessionId));
  }

  /** A presigned POST for one voice note (purpose `voice`, at most 10 MB). */
  async voiceUpload(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    sessionId: string,
    body: InterviewVoiceBody,
  ): Promise<UploadForm> {
    if (!this.voiceEnabled) throw new ApiProblem(404, "not_found");
    const ctx = await this.views.load(workspaceId, propertyId);
    await this.activeSession(ctx, sessionId);
    const [form] = await this.uploads.createUploads(this.tx, {
      workspaceId,
      purpose: "voice",
      files: [{ contentType: body.contentType, size: body.size }],
      createdBy: caller.userId,
    });
    return form!;
  }

  /** Stores an answer and queues its draft; refused at the AI limit with no call (FR-064). */
  async answer(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    sessionId: string,
    body: InterviewAnswerBody,
  ): Promise<InterviewTurnView> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const session = await this.activeSession(ctx, sessionId);
    const topic = guideTopic(body.topicId);
    if (
      !topic ||
      topic.lockedFieldKind ||
      (session.scopeSectionKind && topic.section !== session.scopeSectionKind)
    ) {
      throw new ApiProblem(422, "validation_failed", "This topic is not part of the interview");
    }
    let uploadId: string | null = null;
    if ("voiceUploadId" in body) {
      if (!this.voiceEnabled) throw new ApiProblem(404, "not_found");
      const [row] = await this.tx
        .select({ id: upload.id, purpose: upload.purpose, createdBy: upload.createdBy })
        .from(upload)
        .where(and(eq(upload.id, body.voiceUploadId), eq(upload.workspaceId, workspaceId)))
        .limit(1);
      if (!row || row.purpose !== "voice") throw new ApiProblem(404, "not_found");
      uploadId = row.id;
    }
    await this.limits.consumeAi(workspaceId);
    const redacted = "text" in body ? redactRestrictedValues(body.text) : null;
    const [turn] = await this.tx
      .insert(interviewTurn)
      .values({
        workspaceId,
        sessionId: session.id,
        topicId: topic.id,
        answerKind: uploadId ? "voice" : "text",
        answerText: redacted?.text ?? null,
        uploadId,
        redactions: (redacted?.counts ?? {}) as Record<string, number>,
        createdBy: caller.userId,
      })
      .returning();
    await this.jobs.send(
      JOB_QUEUES.interviewAnswer,
      { workspaceId, turnId: turn!.id } satisfies InterviewAnswerJob,
      { startAfter: 1, retryLimit: 3, retryBackoff: true },
    );
    return this.turnView(turn!, []);
  }

  async turn(
    workspaceId: string,
    propertyId: string,
    sessionId: string,
    turnId: string,
  ): Promise<InterviewTurnView> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const session = await this.session(ctx, sessionId);
    const [row] = await this.tx
      .select()
      .from(interviewTurn)
      .where(and(eq(interviewTurn.id, turnId), eq(interviewTurn.sessionId, session.id)))
      .limit(1);
    if (!row) throw new ApiProblem(404, "not_found");
    return this.turnView(row, await this.itemIdsOf([row.id]).then((map) => map.get(row.id) ?? []));
  }

  /** Leaves a topic for later; the next question moves on (FR-034). */
  async skip(
    workspaceId: string,
    propertyId: string,
    sessionId: string,
    topicId: string,
  ): Promise<InterviewView> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const session = await this.activeSession(ctx, sessionId);
    if (!guideTopic(topicId)) {
      throw new ApiProblem(422, "validation_failed", "Unknown topic");
    }
    const [updated] = await this.tx
      .update(interviewSession)
      .set({
        skippedTopics: sql`array_append(array_remove(${interviewSession.skippedTopics}, ${topicId}), ${topicId})`,
      })
      .where(eq(interviewSession.id, session.id))
      .returning();
    return this.viewOf(ctx, updated!);
  }

  async finish(workspaceId: string, propertyId: string, sessionId: string): Promise<InterviewView> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const session = await this.session(ctx, sessionId);
    if (session.status !== "active") return this.viewOf(ctx, session);
    const [updated] = await this.tx
      .update(interviewSession)
      .set({ status: "finished", finishedAt: new Date() })
      .where(eq(interviewSession.id, session.id))
      .returning();
    return this.viewOf(ctx, updated!);
  }

  private async session(ctx: GuideContext, sessionId: string): Promise<SessionRow> {
    const [row] = await this.tx
      .select()
      .from(interviewSession)
      .where(and(eq(interviewSession.id, sessionId), eq(interviewSession.guideId, ctx.guide.id)))
      .limit(1);
    if (!row) throw new ApiProblem(404, "not_found");
    return row;
  }

  private async activeSession(ctx: GuideContext, sessionId: string): Promise<SessionRow> {
    const row = await this.session(ctx, sessionId);
    if (row.status !== "active") {
      throw new ApiProblem(409, "interview_active", "This interview is finished", {
        details: { sessionId: row.id },
      });
    }
    return row;
  }

  private async itemIdsOf(turnIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (turnIds.length === 0) return map;
    const rows = await this.tx
      .select({ id: guideItem.id, turnId: guideItem.interviewTurnId })
      .from(guideItem)
      .where(inArray(guideItem.interviewTurnId, turnIds))
      .orderBy(asc(guideItem.position));
    for (const row of rows) {
      if (!row.turnId) continue;
      map.set(row.turnId, [...(map.get(row.turnId) ?? []), row.id]);
    }
    return map;
  }

  private turnView(row: TurnRow, itemIds: string[]): InterviewTurnView {
    return {
      id: row.id,
      topicId: row.topicId,
      answerKind: row.answerKind,
      status: row.status,
      errorCode: row.errorCode,
      answerText: row.contentDeletedAt ? null : row.answerText,
      transcript: row.contentDeletedAt ? null : row.transcript,
      redactions: row.redactions,
      followUp: row.followUp,
      itemIds,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * The next question (R11): the heaviest missing topic in scope that was not skipped and has no
   * answer in flight. A topic gets its catalog question first; after one answer, the model's
   * follow-up if it gave one; after that the interview moves on, even if the topic stays missing.
   * A failed answer counts as answered, so a question never comes back in a loop (feature 020
   * FR-003). Media-only topics say so, so the portal offers an attach button (FR-006).
   */
  nextQuestion(ctx: GuideContext, session: SessionRow, turns: TurnRow[]): InterviewQuestion | null {
    if (session.status !== "active") return null;
    const missing = this.views.completeness(ctx).missing;
    const skipped = new Set(session.skippedTopics);
    for (const entry of missing) {
      if (session.scopeSectionKind && entry.sectionKind !== session.scopeSectionKind) continue;
      if (skipped.has(entry.topicId)) continue;
      const topic = guideTopic(entry.topicId);
      if (!topic) continue;
      const own = turns.filter((turn) => turn.topicId === topic.id);
      if (own.some((turn) => IN_FLIGHT.has(turn.status))) continue;
      const done = own.filter((turn) => turn.status === "done");
      const answered = own.filter((turn) => turn.status === "done" || turn.status === "failed");
      if (topic.lockedFieldKind) {
        return {
          topicId: topic.id,
          sectionKind: topic.section,
          opensLockedField: topic.lockedFieldKind as InterviewQuestion["opensLockedField"],
        };
      }
      const media = isMediaOnlyTopic(topic) ? { asksMedia: topicMediaKinds(topic) } : {};
      if (answered.length === 0) return { topicId: topic.id, sectionKind: topic.section, ...media };
      const followUp = answered.length === 1 && done.length === 1 ? done[0]!.followUp : null;
      if (followUp) return { topicId: topic.id, sectionKind: topic.section, followUp };
    }
    return null;
  }

  private async viewOf(ctx: GuideContext, session: SessionRow): Promise<InterviewView> {
    const turns = await this.tx
      .select()
      .from(interviewTurn)
      .where(eq(interviewTurn.sessionId, session.id))
      .orderBy(asc(interviewTurn.createdAt));
    const items = await this.itemIdsOf(turns.map((turn) => turn.id));
    return {
      sessionId: session.id,
      status: session.status,
      scopeSectionKind: session.scopeSectionKind,
      question: this.nextQuestion(ctx, session, turns),
      turns: turns.map((turn) => this.turnView(turn, items.get(turn.id) ?? [])),
      voiceEnabled: this.voiceEnabled,
    };
  }
}
