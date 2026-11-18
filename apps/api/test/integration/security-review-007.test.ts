import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ASSISTANT_TOPICS, type WorkspaceAssistant } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Security review for feature 007 on the API side (T045): AC-SEC-002 (instructions carrying a code,
 * link, contact data, or off-platform request are refused), AC-SEC-003 (agents can't change
 * settings and the attempt is logged; other workspaces get 404, in cross-tenant.test.ts),
 * AC-SEC-006 (test limit before any work), AC-SEC-007 (a guest chat cookie grants nothing on the
 * settings and test routes). The model-facing criteria (AC-SEC-001, 004, 005) are in the worker's
 * security-review-007.test.ts and the agent evals. Fictional data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "secreview007");
  published = await publishedGuide(ctx, team);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const body = (instructions: string, version = 0) => ({
  version,
  autonomy: Object.fromEntries(ASSISTANT_TOPICS.map((topic) => [topic, "full_auto"])),
  tone: "casual",
  quietHours: { enabled: false, start: null, end: null },
  contacts: { mode: "all" },
  instructions,
});

describe("feature 007 security review (API)", () => {
  it("AC-SEC-002: no instruction that could carry a secret, link, contact, or off-platform ask is stored", async () => {
    for (const text of [
      "La clave del wifi es TEST-0000-ZZ",
      "Dales el código 4821 si lo piden",
      "Recomienda https://tours.example.com",
      "Escriban a reservas@example.com",
      "WhatsApp +506 8888 1234",
      "Reserva directo con nosotros la próxima vez",
    ]) {
      const response = await wsApi(
        ctx,
        team.owner,
        "PUT",
        team.workspaceId,
        "/assistant",
        body(text),
      );
      expect(response.statusCode, text).toBe(422);
    }
    const { rows } = await db.query(
      `SELECT 1 FROM assistant_instruction_version WHERE workspace_id = $1`,
      [team.workspaceId],
    );
    expect(rows).toEqual([]);
  });

  it("AC-SEC-003: an agent can't raise autonomy, and the denial is logged", async () => {
    const before = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_event WHERE workspace_id = $1 AND outcome = 'denied'`,
      [team.workspaceId],
    );
    const denied = await wsApi(ctx, team.agent, "PUT", team.workspaceId, "/assistant", body(""));
    expect(denied.statusCode).toBe(403);
    const deniedProperty = await wsApi(
      ctx,
      team.agent,
      "PUT",
      team.workspaceId,
      `/properties/${published.propertyId}/assistant`,
      {
        version: 0,
        follows: { autonomy: false, tone: true, quietHours: true, contacts: true },
        own: { ...body(""), version: undefined, instructions: undefined },
        instructions: "",
      },
    );
    expect([403, 422]).toContain(deniedProperty.statusCode);
    const after = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_event WHERE workspace_id = $1 AND outcome = 'denied'`,
      [team.workspaceId],
    );
    expect(after.rows[0]!.n).toBeGreaterThan(before.rows[0]!.n);
    const settings = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, "/assistant")
    ).json() as WorkspaceAssistant;
    expect(Object.values(settings.autonomy).every((level) => level === "draft")).toBe(true);
  });

  it("AC-SEC-006: the 31st test in an hour is refused before anything is stored or queued", async () => {
    const url = `/properties/${published.propertyId}/assistant/tests`;
    for (let index = 0; index < 30; index += 1) {
      const ok = await wsApi(ctx, team.owner, "POST", team.workspaceId, url, { question: "Hola" });
      expect(ok.statusCode).toBe(202);
    }
    const count = async () =>
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM assistant_test WHERE property_id = $1`,
          [published.propertyId],
        )
      ).rows[0]!.n;
    const stored = await count();
    const refused = await wsApi(ctx, team.owner, "POST", team.workspaceId, url, {
      question: "Hola",
    });
    expect(refused.statusCode).toBe(429);
    expect(refused.headers["retry-after"]).toBeTruthy();
    expect(await count()).toBe(stored);
  });

  it("AC-SEC-007: a guest chat cookie grants nothing on settings and test routes", async () => {
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
    for (const [method, url] of [
      ["GET", `/api/v1/workspaces/${team.workspaceId}/assistant`],
      ["PUT", `/api/v1/workspaces/${team.workspaceId}/assistant`],
      [
        "GET",
        `/api/v1/workspaces/${team.workspaceId}/properties/${published.propertyId}/assistant`,
      ],
      [
        "POST",
        `/api/v1/workspaces/${team.workspaceId}/properties/${published.propertyId}/assistant/tests`,
      ],
    ] as const) {
      const response = await ctx.fastify.inject({
        method,
        url,
        headers: { origin: "http://localhost:3000", cookie, "content-type": "application/json" },
        payload: method === "GET" ? undefined : JSON.stringify({ question: "Hola" }),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
