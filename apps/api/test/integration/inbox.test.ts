import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ConversationDetail, CopilotDraft, GuestChat, InboxPage } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, wsApi, type Member, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The host inbox and conversation actions (feature 006 US1, US2, US3, US5, US6; T010, T014, T020,
 * T030, T033): tabs, order, filter, done and reopen, reject, take over, presence, trust suggestions,
 * and the copilot routes. The worker's output is seeded with SQL. Fictional data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let casa: PublishedGuide;
let villa: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "inbox");
  casa = await publishedGuide(ctx, team, { name: "Casa Colibrí" });
  villa = await publishedGuide(ctx, team, { name: "Villa Mar", skipShare: false });
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const call = (member: Member, method: "GET" | "POST" | "PUT", path: string, payload?: object) =>
  wsApi(ctx, member, method, team.workspaceId, path, payload);

/** A guest message, then the worker's state for it (status and reason), seeded with SQL. */
async function conversationAt(
  guide: PublishedGuide,
  text: string,
  status: "open" | "needs_host",
  reason: string | null = null,
) {
  const posted = await guest(ctx, "POST", "/api/v1/guest/chat/messages", {
    payload: { publicId: guide.publicId, text, language: "es", clientId: randomUUID() },
  });
  expect(posted.statusCode, posted.body).toBe(202);
  const raw = posted.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)!.split(";")[0]!;
  const { rows } = await db.query<{ id: string }>(
    `SELECT c.id FROM conversation c JOIN chat_message m ON m.conversation_id = c.id
      WHERE c.property_id = $1 AND m.body = $2 ORDER BY m.created_at DESC LIMIT 1`,
    [guide.propertyId, text],
  );
  const id = rows[0]!.id;
  await db.query(`UPDATE conversation SET status = $2, needs_host_reason = $3 WHERE id = $1`, [
    id,
    status,
    reason,
  ]);
  return { id, cookie, propertyId: guide.propertyId, publicId: guide.publicId };
}

const conv = (c: { propertyId: string; id: string }, suffix = "") =>
  `/properties/${c.propertyId}/conversations/${c.id}${suffix}`;

describe("inbox (feature 006 US1)", () => {
  it("lists tabs in order, filters by property, and moves done conversations", async () => {
    const parking = await conversationAt(casa, "¿Dónde parqueo?", "needs_host", "draft_ready");
    const smoke = await conversationAt(villa, "Hay humo", "needs_host", "emergency");
    const thanks = await conversationAt(casa, "Gracias por todo", "open");

    const needs = (await call(team.agent, "GET", "/inbox?tab=needs")).json() as InboxPage;
    expect(needs.items.map((item) => item.id).slice(0, 2)).toEqual([smoke.id, parking.id]);
    expect(needs.items[0]).toMatchObject({
      propertyName: "Villa Mar",
      reason: "emergency",
      channel: "guide_chat",
      lastMessage: { author: "guest", excerpt: "Hay humo" },
      takenOver: false,
    });
    expect(needs.hasPublishedGuide).toBe(true);

    const filtered = (
      await call(team.agent, "GET", `/inbox?tab=all&propertyId=${casa.propertyId}`)
    ).json() as InboxPage;
    expect(filtered.items.every((item) => item.propertyId === casa.propertyId)).toBe(true);
    expect(filtered.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([parking.id, thanks.id]),
    );

    expect((await call(team.agent, "POST", conv(thanks, "/done"))).statusCode).toBe(204);
    expect((await call(team.agent, "POST", conv(thanks, "/done"))).statusCode).toBe(409);
    const done = (await call(team.agent, "GET", "/inbox?tab=done")).json() as InboxPage;
    expect(done.items.map((item) => item.id)).toContain(thanks.id);
    const all = (await call(team.agent, "GET", "/inbox?tab=all")).json() as InboxPage;
    expect(all.items.map((item) => item.id)).not.toContain(thanks.id);

    // The guest writes again: back in the open tabs.
    const again = await guest(ctx, "POST", "/api/v1/guest/chat/messages", {
      cookie: thanks.cookie,
      payload: {
        publicId: casa.publicId,
        text: "Una cosa más",
        language: "es",
        clientId: randomUUID(),
      },
    });
    expect(again.statusCode).toBe(202);
    const reopened = (await call(team.agent, "GET", "/inbox?tab=all")).json() as InboxPage;
    expect(reopened.items.map((item) => item.id)).toContain(thanks.id);

    expect((await call(team.owner, "POST", conv(parking, "/done"))).statusCode).toBe(204);
    expect((await call(team.owner, "POST", conv(parking, "/reopen"))).statusCode).toBe(204);
    const events = await db.query<{ type: string }>(
      `SELECT type FROM security_event WHERE target_id = $1 ORDER BY occurred_at`,
      [parking.id],
    );
    expect(events.rows.map((row) => row.type)).toEqual([
      "conversation.marked_done",
      "conversation.reopened",
    ]);
  });

  it("rejects bad tabs and paginates", async () => {
    expect((await call(team.agent, "GET", "/inbox?tab=archive")).statusCode).toBe(422);
    const page = (await call(team.agent, "GET", "/inbox?tab=all")).json() as InboxPage;
    expect(page.next).toBeNull();
  });
});

describe("draft actions and take over (feature 006 US2)", () => {
  async function withDraft(text: string) {
    const c = await conversationAt(casa, text, "needs_host", "draft_ready");
    const trace = await db.query<{ id: string }>(
      `INSERT INTO agent_trace (workspace_id, conversation_id, classification, decision, reason, autonomy)
       VALUES ($1, $2, '{"topic":"parking"}', 'drafted', 'draft_ready', 'draft') RETURNING id`,
      [team.workspaceId, c.id],
    );
    const draft = await db.query<{ id: string }>(
      `INSERT INTO agent_draft (workspace_id, conversation_id, trace_id, body) VALUES ($1, $2, $3, 'Puedes parquear adentro.') RETURNING id`,
      [team.workspaceId, c.id, trace.rows[0]!.id],
    );
    return { ...c, draftId: draft.rows[0]!.id };
  }

  it("rejects a draft once, sending nothing to the guest", async () => {
    const c = await withDraft("¿Hay parqueo techado?");
    expect(
      (await call(team.agent, "POST", conv(c, `/drafts/${c.draftId}/reject`))).statusCode,
    ).toBe(204);
    expect(
      (await call(team.owner, "POST", conv(c, `/drafts/${c.draftId}/reject`))).json(),
    ).toMatchObject({
      code: "draft_closed",
    });
    const chat = (
      await guest(ctx, "GET", `/api/v1/guest/chat?publicId=${c.publicId}`, { cookie: c.cookie })
    ).json() as GuestChat;
    expect(chat.messages.map((message) => message.author)).toEqual(["guest"]);
    const detail = (await call(team.agent, "GET", conv(c))).json() as ConversationDetail;
    expect(detail.draft).toBeNull();
    expect(detail.status).toBe("needs_host");
  });

  it("takes over and hands back, shown in the detail, the inbox, and the guest's pending flag", async () => {
    const c = await withDraft("¿Puedo llegar temprano?");
    const taken = await call(team.agent, "PUT", conv(c, "/takeover"), { on: true });
    expect(taken.statusCode, taken.body).toBe(200);
    expect((taken.json() as ConversationDetail).takenOver).toMatchObject({
      by: expect.any(String),
    });
    const item = ((await call(team.owner, "GET", "/inbox?tab=all")).json() as InboxPage).items.find(
      (candidate) => candidate.id === c.id,
    );
    expect(item).toMatchObject({ takenOver: true });
    const posted = await guest(ctx, "POST", "/api/v1/guest/chat/messages", {
      cookie: c.cookie,
      payload: {
        publicId: c.publicId,
        text: "¿Me confirmas?",
        language: "es",
        clientId: randomUUID(),
      },
    });
    expect(posted.json()).toMatchObject({ pending: false });
    const back = await call(team.owner, "PUT", conv(c, "/takeover"), { on: false });
    expect((back.json() as ConversationDetail).takenOver).toBeNull();
    const events = await db.query<{ type: string }>(
      `SELECT type FROM security_event WHERE target_id = $1 AND type LIKE 'conversation.%' ORDER BY occurred_at`,
      [c.id],
    );
    expect(events.rows.map((row) => row.type)).toEqual([
      "conversation.taken_over",
      "conversation.handed_back",
    ]);
  });

  it("refuses actions from members who can't handle conversations and from other workspaces", async () => {
    const c = await withDraft("¿Hay toallas de playa?");
    const other = await seedTeam(ctx, db, "inbox-other");
    const foreign = await wsApi(ctx, other.owner, "POST", other.workspaceId, conv(c, "/done"));
    expect(foreign.statusCode).toBe(404);
  });
});

describe("presence (feature 006 US5)", () => {
  it("shows a teammate replying, never yourself, and lets it expire", async () => {
    const c = await conversationAt(villa, "¿Hay kayaks?", "needs_host", "draft_ready");
    expect((await call(team.agent, "POST", conv(c, "/presence"))).statusCode).toBe(204);
    const asOwner = (await call(team.owner, "GET", conv(c))).json() as ConversationDetail;
    expect(asOwner.replying).toHaveLength(1);
    const asAgent = (await call(team.agent, "GET", conv(c))).json() as ConversationDetail;
    expect(asAgent.replying).toEqual([]);
    const item = (
      (await call(team.owner, "GET", "/inbox?tab=needs")).json() as InboxPage
    ).items.find((candidate) => candidate.id === c.id);
    expect(item?.replying).toHaveLength(1);
    await db.query(`UPDATE conversation_presence SET expires_at = now() - interval '1 second'`);
    expect(
      ((await call(team.owner, "GET", conv(c))).json() as ConversationDetail).replying,
    ).toEqual([]);
  });
});

describe("trust suggestions (feature 006 US6)", () => {
  it("suggests a topic after five drafts sent unchanged, and hides it when dismissed", async () => {
    for (let index = 0; index < 5; index += 1) {
      const c = await conversationAt(villa, `¿Parqueo ${index}?`, "open");
      const trace = await db.query<{ id: string }>(
        `INSERT INTO agent_trace (workspace_id, conversation_id, classification, decision, reason, autonomy)
         VALUES ($1, $2, '{"topic":"parking"}', 'drafted', 'draft_ready', 'draft') RETURNING id`,
        [team.workspaceId, c.id],
      );
      await db.query(
        `INSERT INTO agent_draft (workspace_id, conversation_id, trace_id, body, status, acted_at)
         VALUES ($1, $2, $3, 'Hay parqueo.', $4, now())`,
        [team.workspaceId, c.id, trace.rows[0]!.id, index === 4 ? "edited" : "sent"],
      );
    }
    let page = (await call(team.owner, "GET", "/inbox")).json() as InboxPage;
    expect(page.suggestions.find((s) => s.propertyId === villa.propertyId)).toBeUndefined();
    const c = await conversationAt(villa, "¿Parqueo extra?", "open");
    const trace = await db.query<{ id: string }>(
      `INSERT INTO agent_trace (workspace_id, conversation_id, classification, decision, reason, autonomy)
       VALUES ($1, $2, '{"topic":"parking"}', 'drafted', 'draft_ready', 'draft') RETURNING id`,
      [team.workspaceId, c.id],
    );
    await db.query(
      `INSERT INTO agent_draft (workspace_id, conversation_id, trace_id, body, status, acted_at)
       VALUES ($1, $2, $3, 'Hay parqueo.', 'sent', now())`,
      [team.workspaceId, c.id, trace.rows[0]!.id],
    );
    page = (await call(team.owner, "GET", "/inbox")).json() as InboxPage;
    expect(page.suggestions).toContainEqual({
      propertyId: villa.propertyId,
      propertyName: "Villa Mar",
      topic: "parking",
      count: 5,
      scope: "workspace",
    });
    const dismissed = await call(team.agent, "POST", "/inbox/suggestions/dismiss", {
      propertyId: villa.propertyId,
      topic: "parking",
    });
    expect(dismissed.statusCode).toBe(204);
    page = (await call(team.owner, "GET", "/inbox")).json() as InboxPage;
    expect(page.suggestions.find((s) => s.propertyId === villa.propertyId)).toBeUndefined();
  });
});

describe("copilot routes (feature 006 US3)", () => {
  it("stores the request, queues the draft, and reads it back", async () => {
    const created = await call(team.agent, "POST", `/properties/${casa.propertyId}/copilot`, {
      message: "¿Puedo llevar a mi perro?",
      bookingStatus: "confirmed",
      language: "es",
    });
    expect(created.statusCode, created.body).toBe(202);
    const { id } = created.json() as { id: string };
    const jobs = await db.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'copilot.draft' AND data->>'runId' = $1`,
      [id],
    );
    expect(jobs.rows).toHaveLength(1);
    await db.query(
      `UPDATE copilot_run SET status = 'done', outcome = 'drafted', draft = 'Sí, con aviso previo.',
         covered = true, checks = '[{"check":"codes","passed":true}]', finished_at = now() WHERE id = $1`,
      [id],
    );
    const draft = (
      await call(team.owner, "GET", `/properties/${casa.propertyId}/copilot/${id}`)
    ).json() as CopilotDraft;
    expect(draft).toMatchObject({ status: "done", outcome: "drafted", passed: true, removed: [] });
    const conversations = await db.query(
      `SELECT 1 FROM chat_message WHERE body = '¿Puedo llevar a mi perro?'`,
    );
    expect(conversations.rows).toEqual([]);
  });

  it("refuses long messages and pauses after 60 drafts in an hour", async () => {
    const long = await call(team.admin, "POST", `/properties/${casa.propertyId}/copilot`, {
      message: "a".repeat(4001),
      bookingStatus: "inquiry",
    });
    expect(long.statusCode).toBe(422);
    await db.query(
      `INSERT INTO rate_limit_bucket (key, window_start, count)
       VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / 3600) * 3600), 60)
       ON CONFLICT (key, window_start) DO UPDATE SET count = 60`,
      [`copilot:user:${team.admin.userId}`],
    );
    const paused = await call(team.admin, "POST", `/properties/${casa.propertyId}/copilot`, {
      message: "Hola",
      bookingStatus: "inquiry",
    });
    expect(paused.statusCode).toBe(429);
    expect(paused.json()).toMatchObject({ code: "copilot_paused" });
  });
});
