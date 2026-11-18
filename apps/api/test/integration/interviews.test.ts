import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { InterviewTurnView, InterviewView, PropertyDetail } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The interview API (feature 003 T080, research R11): one active session per guide, the heaviest
 * missing topic first, code topics that open the locked-field form (FR-038), typed answers of at
 * most 2,000 characters through the detector, voice notes behind their flag, skip and finish,
 * resume (FR-035), the AI limit with no job queued (FR-064), and agents reading only. Fictional
 * text only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let propertyId: string;
let sessionId: string;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"), { GUIDE_INTERVIEW_VOICE: "true" });
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "interview");
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Entrevista",
  });
  propertyId = (created.json() as PropertyDetail).id;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const path = (suffix = "") => `/properties/${propertyId}/guide/interview${suffix}`;

async function start(member = team.owner, body: object = {}) {
  return wsApi(ctx, member, "POST", team.workspaceId, path(), body);
}

async function queuedJobs(turnId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM pgboss.job WHERE name = 'interview.answer' AND data->>'turnId' = $1`,
    [turnId],
  );
  return rows[0]?.count ?? 0;
}

describe("the interview (US4)", () => {
  it("starts with the heaviest missing topic, and resumes the same session (FR-034, FR-035)", async () => {
    // Two starts at once (React runs effects twice in development) give one session.
    const [response, twin] = await Promise.all([start(), start()]);
    expect(response.statusCode, response.body).toBe(200);
    expect(twin.statusCode, twin.body).toBe(200);
    const view = response.json() as InterviewView;
    expect((twin.json() as InterviewView).sessionId).toBe(view.sessionId);
    sessionId = view.sessionId;
    expect(view).toMatchObject({ status: "active", scopeSectionKind: null, voiceEnabled: true });
    const completeness = (
      await wsApi(
        ctx,
        team.owner,
        "GET",
        team.workspaceId,
        `/properties/${propertyId}/guide/completeness`,
      )
    ).json() as { missing: { topicId: string }[] };
    expect(view.question?.topicId).toBe(completeness.missing[0]?.topicId);

    const again = (await start()).json() as InterviewView;
    expect(again.sessionId).toBe(sessionId);
    const read = await wsApi(ctx, team.agent, "GET", team.workspaceId, path(`/${sessionId}`));
    expect(read.statusCode).toBe(200);
  });

  it("keeps one active session per guide (409 interview_active)", async () => {
    const other = await start(team.admin);
    expect(other.statusCode).toBe(409);
    expect(other.json()).toMatchObject({ code: "interview_active", sessionId });
  });

  it("opens the locked-field form for code topics instead of asking (FR-038)", async () => {
    let view = (await start()).json() as InterviewView;
    for (
      let guard = 0;
      guard < 40 && view.question && !view.question.opensLockedField;
      guard += 1
    ) {
      view = (
        await wsApi(ctx, team.owner, "POST", team.workspaceId, path(`/${sessionId}/skip`), {
          topicId: view.question.topicId,
        })
      ).json() as InterviewView;
    }
    expect(view.question?.opensLockedField).toBeDefined();
    const answered = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/${sessionId}/answers`),
      { topicId: view.question!.topicId, text: "No lo voy a escribir aquí." },
    );
    expect(answered.statusCode).toBe(422);
    // Skipped topics stay out of the questions.
    const skipped = (
      await wsApi(ctx, team.owner, "POST", team.workspaceId, path(`/${sessionId}/skip`), {
        topicId: view.question!.topicId,
      })
    ).json() as InterviewView;
    expect(skipped.question?.topicId).not.toBe(view.question!.topicId);
  });

  it("stores a typed answer after the detector and queues its draft (AC-SEC-004)", async () => {
    const response = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/${sessionId}/answers`),
      {
        topicId: "checkout.steps",
        text: "Deja las llaves en la mesa. El código de la puerta es 4821.",
      },
    );
    expect(response.statusCode, response.body).toBe(202);
    const turn = response.json() as InterviewTurnView;
    expect(turn).toMatchObject({ topicId: "checkout.steps", answerKind: "text", status: "queued" });
    expect(turn.answerText).not.toContain("4821");
    expect(turn.redactions).toMatchObject({ door_code: 1 });
    expect(response.body).not.toContain("4821");
    const { rows } = await db.query<{ answer_text: string }>(
      `SELECT answer_text FROM interview_turn WHERE id = $1`,
      [turn.id],
    );
    expect(rows[0]?.answer_text).not.toContain("4821");
    expect(await queuedJobs(turn.id)).toBe(1);

    const polled = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      path(`/${sessionId}/turns/${turn.id}`),
    );
    expect(polled.statusCode).toBe(200);
    expect((polled.json() as InterviewTurnView).status).toBe("queued");
    // A topic with an answer in flight is not asked again.
    const view = (await start()).json() as InterviewView;
    expect(view.question?.topicId).not.toBe("checkout.steps");
  });

  it("refuses answers over 2,000 characters and topics outside the catalog", async () => {
    for (const body of [
      { topicId: "checkout.steps", text: "a".repeat(2001) },
      { topicId: "made.up", text: "hola" },
    ]) {
      const response = await wsApi(
        ctx,
        team.owner,
        "POST",
        team.workspaceId,
        path(`/${sessionId}/answers`),
        body,
      );
      expect(response.statusCode).toBe(422);
    }
  });

  it("gives a voice upload form only with the flag on", async () => {
    const form = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/${sessionId}/voice`),
      {
        contentType: "audio/webm",
        size: 120_000,
      },
    );
    expect(form.statusCode, form.body).toBe(201);
    const { uploadId } = form.json() as { uploadId: string };
    const answered = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/${sessionId}/answers`),
      { topicId: "appliances.ac_heating", voiceUploadId: uploadId },
    );
    expect(answered.statusCode, answered.body).toBe(202);
    expect((answered.json() as InterviewTurnView).answerKind).toBe("voice");
    const tooBig = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/${sessionId}/voice`),
      { contentType: "audio/webm", size: 11 * 1024 * 1024 },
    );
    expect(tooBig.statusCode).toBe(422);
  });

  it("refuses at the daily AI limit without queueing anything (FR-064)", async () => {
    await db.query(`UPDATE workspace SET guide_ai_daily_limit = 1 WHERE id = $1`, [
      team.workspaceId,
    ]);
    try {
      const refused = await wsApi(
        ctx,
        team.owner,
        "POST",
        team.workspaceId,
        path(`/${sessionId}/answers`),
        { topicId: "wifi.network", text: "La red se llama Casa Entrevista." },
      );
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toMatchObject({ code: "ai_limit_reached" });
      const { rows } = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM interview_turn WHERE session_id = $1 AND topic_id = 'wifi.network'`,
        [sessionId],
      );
      expect(rows[0]?.count).toBe(0);
    } finally {
      await db.query(`UPDATE workspace SET guide_ai_daily_limit = NULL WHERE id = $1`, [
        team.workspaceId,
      ]);
    }
  });

  it("lets agents read only (AC-SEC-001)", async () => {
    for (const [method, suffix, body] of [
      ["POST", "", {}],
      ["POST", `/${sessionId}/answers`, { topicId: "checkout.steps", text: "hola" }],
      ["POST", `/${sessionId}/skip`, { topicId: "checkout.steps" }],
      ["POST", `/${sessionId}/finish`, undefined],
      ["POST", `/${sessionId}/voice`, { contentType: "audio/webm", size: 1000 }],
    ] as const) {
      const response = await wsApi(ctx, team.agent, method, team.workspaceId, path(suffix), body);
      expect(response.statusCode, `${method} ${suffix}`).toBe(403);
    }
  });

  it("finishes; a finished session asks nothing and accepts no answers", async () => {
    const finished = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/${sessionId}/finish`),
    );
    expect(finished.statusCode).toBe(200);
    expect(finished.json()).toMatchObject({ status: "finished", question: null });
    const late = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/${sessionId}/answers`),
      { topicId: "checkout.steps", text: "hola" },
    );
    expect(late.statusCode).toBe(409);
    // A new interview can start now, scoped to one section.
    const scoped = (await start(team.admin, { sectionKind: "wifi" })).json() as InterviewView;
    expect(scoped.sessionId).not.toBe(sessionId);
    expect(scoped.question?.sectionKind).toBe("wifi");
  });
});
