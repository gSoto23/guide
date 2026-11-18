import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  ConversationDetail,
  ConversationSummary,
  GuestChat,
  MemberChatMessage,
  PropertyAssistantSettings,
  WorkspaceAssistantSettings,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, wsApi, type Member, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Conversations and assistant settings for members (feature 005 US3 and US4, T028, T033): list
 * order, the conversation page with the draft and the member trace, sending a draft unchanged or
 * edited, replies, warnings and their override, first send wins, roles, what guests see, and the
 * autonomy settings with their security events. The worker's output is seeded with SQL.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "conversations");
  published = await publishedGuide(ctx, team);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

interface Seeded {
  conversationId: string;
  draftId: string;
  traceId: string;
  cookie: string;
  sectionId: string;
}

/** A guest message through the guest route, then the worker's holding reply, draft, and trace. */
async function seedDraft(text = "¿A qué hora es la salida?"): Promise<Seeded> {
  const posted = await guest(ctx, "POST", "/api/v1/guest/chat/messages", {
    payload: { publicId: published.publicId, text, language: "es", clientId: randomUUID() },
  });
  expect(posted.statusCode, posted.body).toBe(202);
  const raw = posted.headers["set-cookie"];
  const cookie = (Array.isArray(raw) ? raw[0] : raw)!.split(";")[0]!;
  const { rows } = await db.query<{ id: string; version: string; section: string }>(
    `SELECT c.id, g.published_version_id AS version,
            (SELECT s->>'id' FROM guide_version v, jsonb_array_elements(v.snapshot->'sections') s
              WHERE v.id = g.published_version_id AND s->>'kind' = 'house_rules') AS section
       FROM conversation c JOIN guide g ON g.property_id = c.property_id
       JOIN chat_message m ON m.conversation_id = c.id
      WHERE c.property_id = $1 AND m.body = $2
      ORDER BY m.created_at DESC LIMIT 1`,
    [published.propertyId, text],
  );
  const conv = rows[0]!;
  await db.query(
    `INSERT INTO chat_message (workspace_id, conversation_id, seq, author, kind, body)
     SELECT workspace_id, id, (SELECT max(seq) + 1 FROM chat_message WHERE conversation_id = $1),
            'assistant', 'holding', 'Gracias por tu mensaje. Tu anfitrión lo revisará.'
       FROM conversation WHERE id = $1`,
    [conv.id],
  );
  await db.query(
    `UPDATE agent_draft SET status = 'superseded' WHERE conversation_id = $1 AND status = 'open'`,
    [conv.id],
  );
  const trace = await db.query<{ id: string }>(
    `INSERT INTO agent_trace (workspace_id, conversation_id, classification, decision, reason, autonomy,
       guide_version_id, section_ids, checks, model, input_tokens, cost_usd_micros)
     VALUES ($1, $2, '{"topic":"house_rules","escalation":"none"}', 'drafted', 'draft_ready', 'draft',
       $3, ARRAY[$4]::uuid[], '[{"check":"citation","passed":true}]', 'claude-opus-5-5', 1200, 9000)
     RETURNING id`,
    [team.workspaceId, conv.id, conv.version, conv.section],
  );
  const draft = await db.query<{ id: string }>(
    `INSERT INTO agent_draft (workspace_id, conversation_id, trace_id, body, section_ids)
     VALUES ($1, $2, $3, 'Las horas de silencio empiezan a las 10 pm.', ARRAY[$4]::uuid[]) RETURNING id`,
    [team.workspaceId, conv.id, trace.rows[0]!.id, conv.section],
  );
  await db.query(
    `UPDATE conversation SET status = 'needs_host', needs_host_reason = 'draft_ready' WHERE id = $1`,
    [conv.id],
  );
  return {
    conversationId: conv.id,
    draftId: draft.rows[0]!.id,
    traceId: trace.rows[0]!.id,
    cookie,
    sectionId: conv.section,
  };
}

const path = (suffix = "") => `/properties/${published.propertyId}/conversations${suffix}`;
const call = (member: Member, method: "GET" | "POST" | "PUT", suffix: string, payload?: object) =>
  wsApi(ctx, member, method, team.workspaceId, suffix, payload);

const guestChat = async (cookie: string) =>
  (
    await guest(ctx, "GET", `/api/v1/guest/chat?publicId=${published.publicId}`, { cookie })
  ).json() as GuestChat;

describe("conversations (feature 005 US3)", () => {
  it("lists conversations needing the host first, with the latest message", async () => {
    const quiet = await seedDraft("Hola, todo bien");
    await db.query(
      `UPDATE conversation SET status = 'open', needs_host_reason = NULL, last_message_at = now() + interval '1 minute' WHERE id = $1`,
      [quiet.conversationId],
    );
    const urgent = await seedDraft("¿Hay toallas de playa?");
    const response = await call(team.agent, "GET", path());
    expect(response.statusCode, response.body).toBe(200);
    const list = response.json() as ConversationSummary[];
    const ids = list.map((item) => item.id);
    expect(ids.indexOf(urgent.conversationId)).toBeLessThan(ids.indexOf(quiet.conversationId));
    const item = list.find((entry) => entry.id === urgent.conversationId)!;
    expect(item).toMatchObject({ status: "needs_host", reason: "draft_ready", stay: null });
    expect(item.lastMessage?.author).toBe("assistant");
  });

  it("shows the transcript, the open draft with sources, and the member trace without cost", async () => {
    const seeded = await seedDraft("¿Se puede hacer ruido de noche?");
    const response = await call(team.agent, "GET", path(`/${seeded.conversationId}`));
    expect(response.statusCode, response.body).toBe(200);
    const detail = response.json() as ConversationDetail;
    expect(detail.messages.map((message) => message.author)).toEqual(["guest", "assistant"]);
    expect(detail.draft).toMatchObject({
      id: seeded.draftId,
      body: "Las horas de silencio empiezan a las 10 pm.",
      sections: [{ id: seeded.sectionId, title: "Normas de la casa" }],
      traceId: seeded.traceId,
    });
    expect(detail.canReply).toBe(true);
    const [trace] = detail.traces;
    expect(trace).toMatchObject({
      id: seeded.traceId,
      topic: "house_rules",
      decision: "drafted",
      reason: "draft_ready",
      autonomy: "draft",
      guideVersion: 1,
      sentBy: null,
      edited: false,
    });
    const body = response.body;
    expect(body).not.toContain("claude-opus-5-5");
    expect(body).not.toMatch(/cost|token|cookie/i);
  });

  it("sends a draft unchanged as the assistant and closes it; a second send gets draft_closed", async () => {
    const seeded = await seedDraft("¿Hasta qué hora hay silencio?");
    const sent = await call(
      team.agent,
      "POST",
      path(`/${seeded.conversationId}/drafts/${seeded.draftId}/send`),
      {},
    );
    expect(sent.statusCode, sent.body).toBe(201);
    const message = sent.json() as MemberChatMessage;
    expect(message).toMatchObject({
      author: "assistant",
      body: "Las horas de silencio empiezan a las 10 pm.",
    });
    expect(message.sections).toEqual([{ id: seeded.sectionId, title: "Normas de la casa" }]);
    const again = await call(
      team.owner,
      "POST",
      path(`/${seeded.conversationId}/drafts/${seeded.draftId}/send`),
      {},
    );
    expect(again.statusCode).toBe(409);
    expect((again.json() as { code: string }).code).toBe("draft_closed");
    const { rows } = await db.query<{
      status: string;
      reason: string | null;
      sent_by: string;
      edited: boolean;
      draft: string;
    }>(
      `SELECT c.status, c.needs_host_reason AS reason, t.sent_by, t.edited, d.status AS draft
         FROM conversation c JOIN agent_trace t ON t.id = $2 JOIN agent_draft d ON d.id = $3
        WHERE c.id = $1`,
      [seeded.conversationId, seeded.traceId, seeded.draftId],
    );
    expect(rows[0]).toEqual({
      status: "open",
      reason: null,
      sent_by: team.agent.userId,
      edited: false,
      draft: "sent",
    });
    // The guest sees it as the assistant's reply (FR-027).
    const chat = await guestChat(seeded.cookie);
    const last = chat.messages.at(-1)!;
    expect(last).toMatchObject({ author: "assistant", authorName: null, body: message.body });
    const events = await db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM security_event WHERE type = 'conversation.replied' AND target_id = $1`,
      [seeded.conversationId],
    );
    expect(events.rows[0]?.metadata).toEqual({
      propertyId: published.propertyId,
      conversationId: seeded.conversationId,
      fromDraft: true,
      edited: false,
    });
  });

  it("sends an edited draft, warning about forbidden promises until acknowledged (PC-14)", async () => {
    const seeded = await seedDraft("¿Me devuelven el depósito?");
    const url = path(`/${seeded.conversationId}/drafts/${seeded.draftId}/send`);
    const warned = await call(team.admin, "POST", url, { text: "Te damos un reembolso completo." });
    expect(warned.statusCode).toBe(422);
    expect(warned.json()).toMatchObject({ code: "reply_warnings", warnings: ["promises"] });
    const sent = await call(team.admin, "POST", url, {
      text: "Te damos un reembolso completo.",
      acknowledgeWarnings: true,
    });
    expect(sent.statusCode, sent.body).toBe(201);
    const { rows } = await db.query<{ edited: boolean; status: string }>(
      `SELECT t.edited, d.status FROM agent_trace t JOIN agent_draft d ON d.trace_id = t.id WHERE t.id = $1`,
      [seeded.traceId],
    );
    expect(rows[0]).toEqual({ edited: true, status: "edited" });
  });

  it("lets members reply with their name, closing the open draft (FR-026, FR-027)", async () => {
    const seeded = await seedDraft("¿Puedo llegar a las 9 pm?");
    const replied = await call(team.agent, "POST", path(`/${seeded.conversationId}/replies`), {
      text: "¡Claro! Te esperamos.",
    });
    expect(replied.statusCode, replied.body).toBe(201);
    expect((replied.json() as MemberChatMessage).author).toBe("host");
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM agent_draft WHERE id = $1`,
      [seeded.draftId],
    );
    expect(rows[0]?.status).toBe("discarded");
    const chat = await guestChat(seeded.cookie);
    const last = chat.messages.at(-1)!;
    expect(last.author).toBe("host");
    expect(last.authorName).toBeTruthy();
    expect(chat.conversation?.status).toBe("open");
    const warned = await call(team.agent, "POST", path(`/${seeded.conversationId}/replies`), {
      text: "La próxima vez reserva directo con nosotros.",
    });
    expect(warned.statusCode).toBe(422);
    expect(warned.json()).toMatchObject({ code: "reply_warnings", warnings: ["off_platform"] });
  });

  it("finds nothing for another property's conversation or an unknown draft", async () => {
    const seeded = await seedDraft("¿Dónde está la playa?");
    const other = await publishedGuide(ctx, team, { name: "Casa Tucán", skipShare: true });
    const crossed = await call(
      team.owner,
      "GET",
      `/properties/${other.propertyId}/conversations/${seeded.conversationId}`,
    );
    expect(crossed.statusCode).toBe(404);
    const unknown = await call(
      team.owner,
      "POST",
      path(`/${seeded.conversationId}/drafts/${randomUUID()}/send`),
      {},
    );
    expect(unknown.statusCode).toBe(404);
  });
});

describe("assistant settings (feature 005 US4)", () => {
  it("defaults to draft; owners and admins change it, agents cannot; changes are logged", async () => {
    const read = await call(team.agent, "GET", "/assistant-settings");
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ autonomy: "draft" } satisfies WorkspaceAssistantSettings);
    const denied = await call(team.agent, "PUT", "/assistant-settings", { autonomy: "auto" });
    expect(denied.statusCode).toBe(403);
    const changed = await call(team.admin, "PUT", "/assistant-settings", { autonomy: "auto" });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toEqual({ autonomy: "auto" });
    const events = await db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM security_event WHERE type = 'assistant.autonomy_changed' AND workspace_id = $1 AND target_type = 'workspace'`,
      [team.workspaceId],
    );
    expect(events.rows.map((row) => row.metadata)).toEqual([{ autonomy: "auto" }]);
    await call(team.owner, "PUT", "/assistant-settings", { autonomy: "draft" });
  });

  it("overrides per property, follows the default when cleared, and rejects agents", async () => {
    const url = `/properties/${published.propertyId}/assistant-settings`;
    expect((await call(team.agent, "GET", url)).json()).toEqual({
      override: null,
      effective: "draft",
    } satisfies PropertyAssistantSettings);
    expect((await call(team.agent, "PUT", url, { override: "auto" })).statusCode).toBe(403);
    const set = await call(team.owner, "PUT", url, { override: "auto" });
    expect(set.json()).toEqual({ override: "auto", effective: "auto" });
    const cleared = await call(team.owner, "PUT", url, { override: null });
    expect(cleared.json()).toEqual({ override: null, effective: "draft" });
    const events = await db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM security_event WHERE type = 'assistant.autonomy_changed' AND target_id = $1 ORDER BY occurred_at`,
      [published.propertyId],
    );
    expect(events.rows.map((row) => row.metadata)).toEqual([
      { propertyId: published.propertyId, autonomy: "auto" },
      { propertyId: published.propertyId, autonomy: "default" },
    ]);
  });
});
