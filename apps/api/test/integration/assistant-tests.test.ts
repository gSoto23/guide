import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { AssistantTest } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, wsApi, type Member, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * "Test the assistant" routes (feature 007 US5, T036): the question is stored and the dry run is
 * queued, the result reads back with section titles, an unpublished guide is refused, members are
 * limited to 30 tests an hour, and another workspace's test is not found. The worker's result is
 * written with SQL. Fictional data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let other: TeamWorkspace;
let published: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "assistant-tests");
  other = await seedTeam(ctx, db, "assistant-tests-other");
  published = await publishedGuide(ctx, team);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const call = (member: Member, method: "GET" | "POST", suffix: string, payload?: object) =>
  wsApi(ctx, member, method, team.workspaceId, suffix, payload);
const tests = () => `/properties/${published.propertyId}/assistant/tests`;

describe("assistant tests (feature 007 US5)", () => {
  it("stores the question, queues the run, and reads the result back", async () => {
    const created = await call(team.agent, "POST", tests(), {
      question: "¿A qué hora es la salida?",
      language: "es",
    });
    expect(created.statusCode, created.body).toBe(202);
    const { id } = created.json() as { id: string };
    const jobs = await db.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'assistant.test' AND data->>'testId' = $1`,
      [id],
    );
    expect(jobs.rows).toHaveLength(1);
    const pending = (await call(team.agent, "GET", `${tests()}/${id}`)).json() as AssistantTest;
    expect(pending).toMatchObject({
      status: "pending",
      outcome: null,
      question: "¿A qué hora es la salida?",
    });

    const { rows } = await db.query<{ section: string }>(
      `SELECT s->>'id' AS section FROM guide g JOIN guide_version v ON v.id = g.published_version_id,
              jsonb_array_elements(v.snapshot->'sections') s
        WHERE g.property_id = $1 AND s->>'kind' = 'checkout'`,
      [published.propertyId],
    );
    await db.query(
      `UPDATE assistant_test SET status = 'done', outcome = 'sent', topic = 'checkout',
         answer_kind = 'grounded', reply = 'La salida es a las 11:00.', section_ids = ARRAY[$2]::uuid[],
         finished_at = now() WHERE id = $1`,
      [id, rows[0]!.section],
    );
    const done = (await call(team.owner, "GET", `${tests()}/${id}`)).json() as AssistantTest;
    expect(done).toMatchObject({
      status: "done",
      outcome: "sent",
      topic: "checkout",
      answerKind: "grounded",
      reply: "La salida es a las 11:00.",
      sections: [{ id: rows[0]!.section, title: "Salida" }],
    });
    // Nothing reached a guest: no conversation exists for the property.
    const conversations = await db.query(`SELECT 1 FROM conversation WHERE property_id = $1`, [
      published.propertyId,
    ]);
    expect(conversations.rows).toEqual([]);
  });

  it("refuses a property without a published guide", async () => {
    await db.query(`UPDATE guide SET status = 'draft' WHERE property_id = $1`, [
      published.propertyId,
    ]);
    const refused = await call(team.owner, "POST", tests(), { question: "Hola" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "guide_not_published" });
    await db.query(`UPDATE guide SET status = 'published' WHERE property_id = $1`, [
      published.propertyId,
    ]);
  });

  it("pauses a member after 30 tests in an hour", async () => {
    let last = 0;
    for (let index = 0; index < 31; index += 1) {
      const response = await call(team.admin, "POST", tests(), { question: `Pregunta ${index}` });
      last = response.statusCode;
      if (index < 30) expect(response.statusCode, `test ${index}`).toBe(202);
      else {
        expect(response.json()).toMatchObject({ code: "tests_paused" });
        expect(
          (response.json() as { retryAfterSeconds: number }).retryAfterSeconds,
        ).toBeGreaterThan(0);
      }
    }
    expect(last).toBe(429);
  });

  it("never shows another workspace's test", async () => {
    const created = await call(team.owner, "POST", tests(), { question: "¿Hay toallas?" });
    const { id } = created.json() as { id: string };
    const foreign = await wsApi(
      ctx,
      other.owner,
      "GET",
      other.workspaceId,
      `/properties/${published.propertyId}/assistant/tests/${id}`,
    );
    expect(foreign.statusCode).toBe(404);
  });
});
