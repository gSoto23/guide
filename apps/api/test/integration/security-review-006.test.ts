import { randomUUID } from "node:crypto";
import { createECDH } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { PushStatus } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { api } from "./invitation-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Security review for feature 006 on the API side (T037): AC-SEC-005 (another user can't delete or
 * test a member's push device), AC-SEC-006 (the 61st copilot draft in an hour is refused before
 * anything is stored or queued), and a guest chat cookie grants nothing on the inbox, conversation
 * actions, copilot, or push routes. AC-SEC-004 is in cross-tenant.test.ts; the model-facing and push
 * payload criteria are in the worker's security-review-006.test.ts and the agent evals. Fictional
 * data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"), {
    VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString("base64url"),
    VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString("base64url"),
    VAPID_SUBJECT: "https://app.guidesk.test",
  });
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "secreview006");
  published = await publishedGuide(ctx, team);
});

afterAll(async () => {
  Object.assign(process.env, { VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "", VAPID_SUBJECT: "" });
  await db.close();
  await ctx.app.close();
});

const count = async (query: string, params: unknown[]) =>
  (await db.query<{ n: number }>(query, params)).rows[0]!.n;

describe("feature 006 security review (API)", () => {
  it("AC-SEC-005: another member can't delete or test someone's push device", async () => {
    const subscribed = await api(ctx, "POST", "/api/v1/me/push/subscriptions", team.owner.cookie, {
      endpoint: `https://push.example.test/${randomUUID()}`,
      keys: { p256dh: "BTestKeyOnlyForTests", auth: "authTestOnly" },
      device: "chrome-android",
    });
    expect(subscribed.statusCode).toBe(201);
    const { id } = subscribed.json() as { id: string };
    const devices = async () =>
      count(`SELECT count(*)::int AS n FROM push_subscription WHERE user_id = $1`, [
        team.owner.userId,
      ]);

    for (const member of [team.admin, team.agent]) {
      const deleted = await api(
        ctx,
        "DELETE",
        `/api/v1/me/push/subscriptions/${id}`,
        member.cookie,
      );
      expect(deleted.statusCode).toBe(404);
      // A test push goes to the caller's own devices only, never to the owner's.
      await api(ctx, "POST", "/api/v1/me/push/test", member.cookie);
      const listed = (await api(ctx, "GET", "/api/v1/me/push", member.cookie)).json() as PushStatus;
      expect(listed.devices).toEqual([]);
    }
    expect(await devices()).toBe(1);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM pgboss.job
          WHERE name = 'notification.push' AND data->>'kind' = 'test' AND data->>'userId' = $1`,
        [team.owner.userId],
      ),
    ).toBe(0);
  });

  it("AC-SEC-006: the 61st copilot draft in an hour is refused before anything is stored or queued", async () => {
    const url = `/properties/${published.propertyId}/copilot`;
    await db.query(
      `INSERT INTO rate_limit_bucket (key, window_start, count)
       VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / 3600) * 3600), 60)
       ON CONFLICT (key, window_start) DO UPDATE SET count = 60`,
      [`copilot:user:${team.agent.userId}`],
    );
    const runs = () =>
      count(`SELECT count(*)::int AS n FROM copilot_run WHERE property_id = $1`, [
        published.propertyId,
      ]);
    const jobs = () =>
      count(`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'copilot.draft'`, []);
    const [storedRuns, queuedJobs] = [await runs(), await jobs()];
    const refused = await wsApi(ctx, team.agent, "POST", team.workspaceId, url, {
      message: "¿A qué hora es la salida?",
      bookingStatus: "confirmed",
    });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: "copilot_paused" });
    expect(refused.headers["retry-after"]).toBeTruthy();
    expect([await runs(), await jobs()]).toEqual([storedRuns, queuedJobs]);

    // Another member still has their own allowance.
    const allowed = await wsApi(ctx, team.admin, "POST", team.workspaceId, url, {
      message: "¿A qué hora es la salida?",
      bookingStatus: "confirmed",
    });
    expect(allowed.statusCode).toBe(202);
  });

  it("a guest chat cookie grants nothing on the inbox, conversation, copilot, or push routes", async () => {
    const posted = await guest(ctx, "POST", "/api/v1/guest/chat/messages", {
      payload: {
        publicId: published.publicId,
        text: "Hola",
        language: "es",
        clientId: randomUUID(),
      },
    });
    const raw = posted.headers["set-cookie"];
    const cookie = (Array.isArray(raw) ? raw[0] : raw)!.split(";")[0]!;
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM conversation WHERE property_id = $1 LIMIT 1`,
      [published.propertyId],
    );
    const ws = `/api/v1/workspaces/${team.workspaceId}`;
    const conv = `${ws}/properties/${published.propertyId}/conversations/${rows[0]!.id}`;
    for (const [method, url, payload] of [
      ["GET", `${ws}/inbox`, undefined],
      [
        "POST",
        `${ws}/inbox/suggestions/dismiss`,
        { propertyId: published.propertyId, topic: "arrival" },
      ],
      ["POST", `${conv}/done`, {}],
      ["PUT", `${conv}/takeover`, { on: true }],
      ["POST", `${conv}/presence`, {}],
      [
        "POST",
        `${ws}/properties/${published.propertyId}/copilot`,
        { message: "Hola", bookingStatus: "confirmed" },
      ],
      ["GET", "/api/v1/me/push", undefined],
      ["POST", "/api/v1/me/push/test", {}],
    ] as const) {
      const response = await ctx.fastify.inject({
        method,
        url,
        headers: {
          origin: "http://localhost:3000",
          cookie,
          ...(payload ? { "content-type": "application/json" } : {}),
        },
        ...(payload ? { payload: JSON.stringify(payload) } : {}),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
    const [conversation] = (
      await db.query<{ status: string; taken: boolean }>(
        `SELECT status, taken_over_by IS NOT NULL AS taken FROM conversation WHERE id = $1`,
        [rows[0]!.id],
      )
    ).rows;
    expect(conversation!.status).not.toBe("done");
    expect(conversation!.taken).toBe(false);
  });
});
