import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Security review for feature 005 on the API side (T044): AC-SEC-005 (device limit before any
 * work), AC-SEC-007 (a chat cookie grants nothing on member routes; another property's conversation
 * is not found), SEC-11 (host-only HttpOnly cookie, no-store, noindex), and SEC-20 (no guest contact
 * data stored). AC-SEC-006 is in cross-tenant.test.ts; the model-facing criteria (AC-SEC-001 to 004,
 * 008, 009) are in the worker's security-review-005.test.ts. Fictional data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "secreview005");
  published = await publishedGuide(ctx, team);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

async function firstMessage(text: string) {
  const response = await guest(ctx, "POST", "/api/v1/guest/chat/messages", {
    payload: { publicId: published.publicId, text, language: "es", clientId: randomUUID() },
  });
  expect(response.statusCode, response.body).toBe(202);
  const raw = response.headers["set-cookie"];
  return { response, cookie: (Array.isArray(raw) ? raw[0] : raw)!.split(";")[0]! };
}

describe("feature 005 security review (API)", () => {
  it("SEC-11: the chat cookie is host-only and HttpOnly; responses are never cached or indexed", async () => {
    const { response } = await firstMessage("Hola");
    const raw = response.headers["set-cookie"];
    const header = (Array.isArray(raw) ? raw[0] : raw)!;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).not.toMatch(/Domain=/i);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("AC-SEC-007: a chat cookie grants nothing on member routes", async () => {
    const { cookie } = await firstMessage("¿Hay toallas?");
    for (const url of [
      `/api/v1/workspaces/${team.workspaceId}/properties/${published.propertyId}/conversations`,
      `/api/v1/workspaces/${team.workspaceId}/assistant-settings`,
      "/api/v1/me",
    ]) {
      const response = await ctx.fastify.inject({
        method: "GET",
        url,
        headers: { origin: "http://localhost:3000", cookie },
      });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it("AC-SEC-007: a guest device never reads a conversation by guessing its ID or another cookie", async () => {
    const { cookie } = await firstMessage("Mensaje privado de prueba");
    const forged = `${cookie.split("=")[0]}=${"A".repeat(43)}`;
    const chat = await guest(ctx, "GET", `/api/v1/guest/chat?publicId=${published.publicId}`, {
      cookie: forged,
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json()).toMatchObject({ conversation: null, messages: [] });
    // The query string accepts nothing but the property link and a cursor.
    const { rows } = await db.query<{ id: string }>(
      `SELECT c.id FROM conversation c JOIN chat_message m ON m.conversation_id = c.id WHERE m.body = 'Mensaje privado de prueba'`,
    );
    const probe = await guest(
      ctx,
      "GET",
      `/api/v1/guest/chat?publicId=${published.publicId}&conversationId=${rows[0]!.id}`,
    );
    expect(probe.statusCode).toBe(422);
  });

  it("AC-SEC-005: a paused device is refused before anything is stored or queued", async () => {
    const { cookie } = await firstMessage("Uno");
    const ip = "10.251.2.3";
    for (let i = 0; i < 19; i += 1) {
      await guest(ctx, "POST", "/api/v1/guest/chat/messages", {
        cookie,
        headers: { "x-forwarded-for": ip },
        payload: {
          publicId: published.publicId,
          text: `Mensaje ${i}`,
          language: "es",
          clientId: randomUUID(),
        },
      });
    }
    const { rows: before } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'chat.reply'`,
    );
    const paused = await guest(ctx, "POST", "/api/v1/guest/chat/messages", {
      cookie,
      headers: { "x-forwarded-for": ip },
      payload: {
        publicId: published.publicId,
        text: "Bloqueado",
        language: "es",
        clientId: randomUUID(),
      },
    });
    expect(paused.statusCode).toBe(429);
    const { rows: after } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'chat.reply'`,
    );
    expect(after[0]!.n).toBe(before[0]!.n);
    expect((await db.query(`SELECT 1 FROM chat_message WHERE body = 'Bloqueado'`)).rows).toEqual(
      [],
    );
  });

  it("SEC-20: conversations store no contact data and no raw cookie", async () => {
    const { cookie } = await firstMessage("Sin datos de contacto");
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT c.* FROM conversation c JOIN chat_message m ON m.conversation_id = c.id WHERE m.body = 'Sin datos de contacto'`,
    );
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain(cookie.split("=")[1]);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        "cookie_hash",
        "created_at",
        "id",
        "language",
        "last_message_at",
        "last_notified_at",
        "needs_host_reason",
        "property_id",
        "status",
        "stay_id",
        "workspace_id",
      ].sort(),
    );
  });
});
