import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuestChat, PostChatMessageResponse } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  addStay,
  copyStayLink,
  exchange,
  guest,
  publishedGuide,
  type PublishedGuide,
} from "./guest-helpers.js";
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Guest chat routes (feature 005 US1, T014): intro, the first message sets the chat cookie,
 * idempotent client IDs, messages after a cursor, the 2,000-character limit, unavailable guides,
 * another property's conversation, the stay label, and the device limit. Fictional data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let other: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "guestchat");
  published = await publishedGuide(ctx, team);
  other = await publishedGuide(ctx, team, { name: "Casa Tucán" });
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const chatOf = (publicId: string, cookie?: string, after?: number) =>
  guest(
    ctx,
    "GET",
    `/api/v1/guest/chat?publicId=${publicId}${after !== undefined ? `&after=${after}` : ""}`,
    cookie ? { cookie } : {},
  );

const send = (
  publicId: string,
  text: string,
  options: { cookie?: string; clientId?: string; ip?: string } = {},
) =>
  guest(ctx, "POST", "/api/v1/guest/chat/messages", {
    payload: { publicId, text, language: "es", clientId: options.clientId ?? randomUUID() },
    ...(options.cookie ? { cookie: options.cookie } : {}),
    ...(options.ip ? { headers: { "x-forwarded-for": options.ip } } : {}),
  });

function cookieFrom(response: { headers: Record<string, unknown> }): string | null {
  const raw = response.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value.split(";")[0]! : null;
}

describe("guest chat (feature 005 US1)", () => {
  it("opens with the intro and no conversation before the first message (FR-003)", async () => {
    const response = await chatOf(published.publicId);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    const body = response.json() as GuestChat;
    expect(body.intro.propertyName).toBe("Casa Colibrí");
    expect(body.intro.hostName).toBeTruthy();
    expect(body.intro.emergencyNumber).toBe("911");
    expect(body.intro.suggestions).toEqual([
      "arrival",
      "wifi",
      "house_rules",
      "local_recommendations",
    ]);
    expect(body.conversation).toBeNull();
    expect(body.messages).toEqual([]);
  });

  it("stores the first message, sets an HttpOnly chat cookie, and queues the reply (FR-004)", async () => {
    const response = await send(published.publicId, "¿A qué hora es la salida?");
    expect(response.statusCode, response.body).toBe(202);
    const raw = response.headers["set-cookie"];
    expect(Array.isArray(raw) ? raw[0] : raw).toMatch(
      /^guidesk_chat=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=7776000; HttpOnly; SameSite=Lax$/,
    );
    const body = response.json() as PostChatMessageResponse;
    expect(body.pending).toBe(true);
    expect(body.message).toMatchObject({
      seq: 1,
      author: "guest",
      kind: "text",
      body: "¿A qué hora es la salida?",
    });
    const cookie = cookieFrom(response)!;
    const { rows } = await db.query<{ cookie_hash: string; stay_id: string | null; id: string }>(
      `SELECT id, cookie_hash, stay_id FROM conversation WHERE property_id = $1`,
      [published.propertyId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cookie_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.cookie_hash).not.toBe(cookie.split("=")[1]);
    expect(rows[0]!.stay_id).toBeNull();
    const jobs = await db.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'chat.reply' AND data->>'conversationId' = $1`,
      [rows[0]!.id],
    );
    expect(jobs.rows.length).toBeGreaterThanOrEqual(1);
    const chat = (await chatOf(published.publicId, cookie)).json() as GuestChat;
    expect(chat.conversation).toEqual({ status: "open", pending: true });
    expect(chat.messages.map((message) => message.seq)).toEqual([1]);
  });

  it("returns the original message for a repeated client ID (idempotent retries)", async () => {
    const first = await send(published.publicId, "Hola");
    const cookie = cookieFrom(first)!;
    const clientId = randomUUID();
    const a = await send(published.publicId, "¿Hay parqueo?", { cookie, clientId });
    const b = await send(published.publicId, "¿Hay parqueo?", { cookie, clientId });
    expect(a.statusCode).toBe(202);
    expect(b.statusCode).toBe(202);
    const ma = (a.json() as PostChatMessageResponse).message;
    const mb = (b.json() as PostChatMessageResponse).message;
    expect(mb.seq).toBe(ma.seq);
    expect(b.headers["set-cookie"]).toBeUndefined();
    const chat = (await chatOf(published.publicId, cookie)).json() as GuestChat;
    expect(chat.messages.map((message) => message.body)).toEqual(["Hola", "¿Hay parqueo?"]);
  });

  it("returns only messages after the cursor, including assistant and host replies", async () => {
    const first = await send(published.publicId, "Primera");
    const cookie = cookieFrom(first)!;
    const { rows } = await db.query<{ id: string; workspace_id: string }>(
      `SELECT c.id, c.workspace_id FROM conversation c JOIN chat_message m ON m.conversation_id = c.id
        WHERE c.property_id = $1 AND m.body = 'Primera'`,
      [published.propertyId],
    );
    const conv = rows[0]!;
    await db.query(
      `INSERT INTO chat_message (workspace_id, conversation_id, seq, author, kind, body, payload, author_user_id)
       VALUES ($1, $2, 2, 'assistant', 'text', 'La salida es a las 11:00.', $3, NULL),
              ($1, $2, 3, 'host', 'text', 'Con gusto.', NULL, $4)`,
      [
        conv.workspace_id,
        conv.id,
        JSON.stringify({ sections: [{ id: randomUUID(), title: "Salida" }] }),
        team.owner.userId,
      ],
    );
    const after = (await chatOf(published.publicId, cookie, 1)).json() as GuestChat;
    expect(after.messages.map((message) => [message.seq, message.author])).toEqual([
      [2, "assistant"],
      [3, "host"],
    ]);
    expect(after.messages[0]!.sections[0]!.title).toBe("Salida");
    expect(after.messages[0]!.authorName).toBeNull();
    expect(after.messages[1]!.authorName).toBeTruthy();
    expect(after.conversation?.pending).toBe(false);
  });

  it("refuses messages over 2,000 characters and empty ones (FR-006)", async () => {
    const long = await send(published.publicId, "a".repeat(2001));
    expect(long.statusCode).toBe(422);
    expect((long.json() as { code: string }).code).toBe("message_too_long");
    const exact = await send(published.publicId, "b".repeat(2000));
    expect(exact.statusCode).toBe(202);
    const empty = await send(published.publicId, "   ");
    expect(empty.statusCode).toBe(422);
  });

  it("answers unavailable for unknown and unpublished guides (spec 004 FR-054)", async () => {
    const unknown = await send("a".repeat(26), "Hola");
    expect(unknown.statusCode).toBe(404);
    expect((unknown.json() as { code: string }).code).toBe("unavailable");
    expect((await chatOf("a".repeat(26))).statusCode).toBe(404);
  });

  it("keeps one conversation per device and property: another property's cookie finds nothing", async () => {
    const first = await send(published.publicId, "Mensaje en Colibrí");
    const cookie = cookieFrom(first)!;
    const elsewhere = (await chatOf(other.publicId, cookie)).json() as GuestChat;
    expect(elsewhere.conversation).toBeNull();
    expect(elsewhere.messages).toEqual([]);
    const posted = await send(other.publicId, "Mensaje en Tucán", { cookie });
    expect(posted.statusCode).toBe(202);
    expect((posted.json() as PostChatMessageResponse).message.seq).toBe(1);
    const { rows } = await db.query<{ property_id: string }>(
      `SELECT DISTINCT c.property_id FROM conversation c JOIN chat_message m ON m.conversation_id = c.id
        WHERE m.body IN ('Mensaje en Colibrí', 'Mensaje en Tucán')`,
    );
    expect(rows.map((row) => row.property_id).sort()).toEqual(
      [published.propertyId, other.propertyId].sort(),
    );
  });

  it("labels the conversation with the device's stay (FR-004)", async () => {
    const stayId = await addStay(ctx, team, published.propertyId, 0);
    const { token } = await copyStayLink(ctx, team, published.propertyId, stayId);
    const device = await exchange(ctx, token);
    const response = await send(published.publicId, "Llegamos hoy", { cookie: device.cookie! });
    expect(response.statusCode).toBe(202);
    const { rows } = await db.query<{ stay_id: string | null }>(
      `SELECT c.stay_id FROM conversation c JOIN chat_message m ON m.conversation_id = c.id WHERE m.body = 'Llegamos hoy'`,
    );
    expect(rows[0]?.stay_id).toBe(stayId);
  });

  it("pauses a device after 20 messages in 10 minutes without storing more (FR-028)", async () => {
    const ip = "10.250.1.1";
    const first = await send(published.publicId, "Mensaje 1", { ip });
    const cookie = cookieFrom(first)!;
    for (let i = 2; i <= 20; i += 1) {
      const response = await send(published.publicId, `Mensaje ${i}`, { cookie, ip });
      expect(response.statusCode).toBe(202);
    }
    const paused = await send(published.publicId, "Mensaje 21", { cookie, ip });
    expect(paused.statusCode).toBe(429);
    const body = paused.json() as { code: string; retryAfterSeconds: number };
    expect(body.code).toBe("chat_paused");
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    const { rows } = await db.query(`SELECT 1 FROM chat_message WHERE body = 'Mensaje 21'`);
    expect(rows).toHaveLength(0);
  });
});
