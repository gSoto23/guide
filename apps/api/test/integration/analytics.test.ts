import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { AnalyticsSummary, UnansweredPage } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { crDate } from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Basic analytics (feature 010 T006, T009, T012, T016): views, stays that opened the guide, questions
 * by outcome, topics, escalation reasons, unanswered questions, Explore, and add-on requests, for a
 * property and the workspace, by the property's local day, against the previous period. Copilot runs
 * never count. Synthetic data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let casa = "";
let utcHouse = "";
let removedBusy = "";
let removedQuiet = "";
const conversations = new Map<string, string>();

/** Noon in Costa Rica `days` days ago (UTC−6). */
const noonAgo = (days: number) => `${crDate(-days)}T18:00:00Z`;

/** Properties are inserted directly: the API asks larger workspaces for a second factor. */
async function createProperty(name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO property (workspace_id, name, guide_languages, setup_status, source, country,
       time_zone, created_by)
     VALUES ($1, $2, ARRAY['es', 'en'], 'ready', 'manual', 'CR', 'America/Costa_Rica', $3)
     RETURNING id`,
    [team.workspaceId, name, team.owner.userId],
  );
  return rows[0]!.id;
}

async function conversationOf(propertyId: string): Promise<string> {
  const known = conversations.get(propertyId);
  if (known) return known;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO conversation (workspace_id, property_id, cookie_hash, language)
     VALUES ($1, $2, md5(random()::text) || md5(random()::text), 'es') RETURNING id`,
    [team.workspaceId, propertyId],
  );
  conversations.set(propertyId, rows[0]!.id);
  return rows[0]!.id;
}

let seq = 0;
async function question(
  propertyId: string,
  at: string,
  decision: string,
  options: { reason?: string; topic?: string | null; text?: string } = {},
): Promise<string> {
  const conversationId = await conversationOf(propertyId);
  seq += 1;
  const { rows: message } = await db.query<{ id: string }>(
    `INSERT INTO chat_message (workspace_id, conversation_id, seq, author, body, created_at)
     VALUES ($1, $2, $3, 'guest', $4, $5) RETURNING id`,
    [team.workspaceId, conversationId, seq, options.text ?? "¿Una pregunta?", at],
  );
  const classification =
    options.topic === null ? null : JSON.stringify({ topic: options.topic ?? "other" });
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO agent_trace (workspace_id, conversation_id, guest_message_id, classification,
       decision, reason, autonomy, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, 'full_auto', $7) RETURNING id`,
    [
      team.workspaceId,
      conversationId,
      message[0]!.id,
      classification,
      decision,
      options.reason ?? null,
      at,
    ],
  );
  return rows[0]!.id;
}

async function stayOpened(propertyId: string, at: string, withRequest = false): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO stay (workspace_id, property_id, source, check_in_date, checkout_date, channel, guide_opened_at)
     VALUES ($1, $2, 'manual', $3, $4, 'Directo', $5) RETURNING id`,
    [team.workspaceId, propertyId, crDate(-3), crDate(2), at],
  );
  if (!withRequest) return;
  const { rows: extra } = await db.query<{ id: string }>(
    `INSERT INTO extra (workspace_id, property_id, source_language, name, price, currency)
     VALUES ($1, $2, 'es', '{"es": "Recogida"}', 85, 'USD') RETURNING id`,
    [team.workspaceId, propertyId],
  );
  await db.query(
    `INSERT INTO service_request (workspace_id, property_id, stay_id, extra_id, extra_name,
       source_language, price, currency, status, expires_at)
     VALUES ($1, $2, $3, $4, '{"es": "Recogida"}', 'es', 85, 'USD', 'waiting', now() + interval '1 day')`,
    [team.workspaceId, propertyId, rows[0]!.id, extra[0]!.id],
  );
}

const daily = (table: string, columns: string, values: unknown[]) =>
  db.query(
    `INSERT INTO ${table} (workspace_id, property_id, ${columns}) VALUES (${values
      .map((_, i) => `$${i + 1}`)
      .join(", ")})`,
    values,
  );

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "analytics");
  casa = await createProperty("Casa Colibrí");
  utcHouse = await createProperty("Casa sin zona");
  removedBusy = await createProperty("Casa retirada");
  removedQuiet = await createProperty("Casa vacía");
  await db.query(`UPDATE property SET time_zone = NULL WHERE id = $1`, [utcHouse]);
  await db.query(
    `UPDATE property SET status = 'removed', removed_at = now(), purge_after = now() + interval '30 days' WHERE id IN ($1, $2)`,
    [removedBusy, removedQuiet],
  );
  const ws = team.workspaceId;

  // Views: 10 property and 5 stay opens yesterday; 4 property opens 10 days ago (previous period).
  await daily("guide_open_daily", "day, link_kind, opens", [ws, casa, crDate(-1), "property", 10]);
  await daily("guide_open_daily", "day, link_kind, opens", [ws, casa, crDate(-1), "stay", 5]);
  await daily("guide_open_daily", "day, link_kind, opens", [ws, casa, crDate(-10), "property", 4]);
  await daily("guide_open_daily", "day, link_kind, opens", [
    ws,
    utcHouse,
    crDate(-1),
    "property",
    2,
  ]);
  await daily("guide_open_daily", "day, link_kind, opens", [
    ws,
    removedBusy,
    crDate(-2),
    "property",
    1,
  ]);

  // Stays: 3 opened two days ago (2 with a request), 1 nine days ago.
  await stayOpened(casa, noonAgo(2), true);
  await stayOpened(casa, noonAgo(2), true);
  await stayOpened(casa, noonAgo(2));
  await stayOpened(casa, noonAgo(9));

  // Questions yesterday: 4 automatic, 1 with the host, 2 escalated, and a greeting.
  for (let i = 0; i < 3; i += 1) await question(casa, noonAgo(1), "answered", { topic: "wifi" });
  await question(casa, noonAgo(1), "pointer", { topic: "arrival" });
  await question(casa, noonAgo(1), "drafted", { reason: "draft_ready", topic: "parking" });
  await question(casa, noonAgo(1), "held", { reason: "emergency", topic: "emergency" });
  await question(casa, noonAgo(1), "held", {
    reason: "not_confident",
    topic: null,
    text: "¿Hay una farmacia <b>cerca</b>? <script>alert(1)</script>",
  });
  await question(casa, noonAgo(1), "greeting", { topic: "greeting" });
  // Previous period: two answers 8 days ago, and one at 23:30 local on day −7, which is day −6 in UTC.
  await question(casa, noonAgo(8), "answered", { topic: "wifi" });
  await question(casa, noonAgo(8), "answered", { topic: "wifi" });
  await question(casa, `${crDate(-6)}T05:30:00Z`, "answered", { topic: "checkout" });
  // A copilot draft is never a guest question.
  const { rows: run } = await db.query<{ id: string }>(
    `INSERT INTO copilot_run (workspace_id, property_id, created_by, message, booking_status)
     VALUES ($1, $2, $3, '¿Hay parqueo?', 'confirmed') RETURNING id`,
    [ws, casa, team.owner.userId],
  );
  await db.query(
    `INSERT INTO agent_trace (workspace_id, copilot_run_id, decision, autonomy, created_at)
     VALUES ($1, $2, 'answered', 'draft', $3)`,
    [ws, run[0]!.id, noonAgo(1)],
  );
  await question(utcHouse, noonAgo(1), "answered", { topic: "wifi" });

  // Explore and requests.
  await daily("explore_open_daily", "day, opens", [ws, casa, crDate(-1), 6]);
  await daily("explore_open_daily", "day, opens", [ws, casa, crDate(-9), 2]);
  await daily("experience_click_daily", "day, partner, ref, clicks", [
    ws,
    casa,
    crDate(-1),
    "viator",
    "viator-P1",
    3,
  ]);
  await daily("experience_click_daily", "day, partner, ref, clicks", [
    ws,
    casa,
    crDate(-1),
    "civitatis",
    "civitatis-C1",
    1,
  ]);
  await daily("service_request_daily", "day, status, count", [ws, casa, crDate(-1), "waiting", 2]);
  await daily("service_request_daily", "day, status, count", [
    ws,
    casa,
    crDate(-1),
    "confirmed",
    1,
  ]);
  await daily("service_request_daily", "day, status, count", [ws, casa, crDate(-10), "waiting", 1]);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const summaryOf = async (query: string, member = team.owner) => {
  const response = await wsApi(ctx, member, "GET", team.workspaceId, `/analytics?${query}`);
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as AnalyticsSummary;
};

describe("property analytics (feature 010 US1)", () => {
  it("counts views, stays, and questions by outcome against the previous period", async () => {
    const s = await summaryOf(`period=7&propertyId=${casa}`);
    expect(s.scope).toEqual({
      kind: "property",
      propertyId: casa,
      propertyName: "Casa Colibrí",
      removed: false,
    });
    expect(s.period).toEqual({ days: 7, timeZones: ["America/Costa_Rica"], utcFallback: false });
    expect(s.views).toEqual({
      property: { current: 10, previous: 4 },
      stay: { current: 5, previous: 0 },
    });
    expect(s.staysOpened).toEqual({ current: 3, previous: 1 });
    expect(s.questions).toEqual({
      total: { current: 7, previous: 3 },
      automatic: { current: 4, previous: 3 },
      withHost: { current: 1, previous: 0 },
      escalated: { current: 2, previous: 0 },
    });
    // The property was created today, so there is nothing to compare with yet.
    expect(s.comparable).toBe(false);
    expect(s.properties).toBeNull();
  });

  it("compares once the property is older than the previous period", async () => {
    await db.query(`UPDATE property SET created_at = now() - interval '100 days' WHERE id = $1`, [
      casa,
    ]);
    expect((await summaryOf(`period=30&propertyId=${casa}`)).comparable).toBe(true);
  });

  it("widens with the period and refuses other periods", async () => {
    const month = await summaryOf(`period=30&propertyId=${casa}`);
    expect(month.views.property).toEqual({ current: 14, previous: 0 });
    expect(month.questions.total).toEqual({ current: 10, previous: 0 });
    for (const query of ["period=14", "period=30&days=2", `propertyId=${casa}`]) {
      const refused = await wsApi(ctx, team.owner, "GET", team.workspaceId, `/analytics?${query}`);
      expect(refused.statusCode, query).toBe(422);
    }
  });

  it("counts by UTC days when a property has no time zone, and shows zeros without data", async () => {
    const s = await summaryOf(`period=7&propertyId=${utcHouse}`);
    expect(s.period).toEqual({ days: 7, timeZones: ["UTC"], utcFallback: true });
    expect(s.questions.automatic.current).toBe(1);
    const quiet = await summaryOf(`period=7&propertyId=${removedQuiet}`);
    expect(quiet.views.property).toEqual({ current: 0, previous: 0 });
    expect(quiet.questions.total).toEqual({ current: 0, previous: 0 });
    expect(quiet.topics).toEqual([]);
  });

  it("lets agents read analytics too", async () => {
    const s = await summaryOf(`period=7&propertyId=${casa}`, team.agent);
    expect(s.questions.total.current).toBe(7);
  });
});

describe("topics, escalations, unanswered (feature 010 US2)", () => {
  it("ranks topics without greetings and counts real escalation reasons", async () => {
    const s = await summaryOf(`period=7&propertyId=${casa}`);
    expect(s.topics).toEqual([
      { topic: "wifi", count: 3 },
      { topic: "arrival", count: 1 },
      { topic: "parking", count: 1 },
      { topic: "emergency", count: 1 },
      { topic: "other", count: 1 },
    ]);
    expect(s.escalations).toEqual([
      { reason: "emergency", count: 1 },
      { reason: "not_confident", count: 1 },
    ]);
    expect(s.unanswered).toBe(1);
  });

  it("lists unanswered questions newest first as stored text, page by page", async () => {
    const house = await createProperty("Casa con dudas");
    for (let i = 0; i < 21; i += 1) {
      await question(
        house,
        `${crDate(-1)}T${String(10 + (i % 12)).padStart(2, "0")}:${String(i).padStart(2, "0")}:00Z`,
        "held",
        {
          reason: "not_confident",
          text: `Pregunta ${i}`,
        },
      );
    }
    const first = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/analytics/unanswered?period=7&propertyId=${house}`,
    );
    const page = first.json() as UnansweredPage;
    expect(page.items).toHaveLength(20);
    expect(page.next).not.toBeNull();
    const times = page.items.map((item) => item.at);
    expect([...times].sort().reverse()).toEqual(times);
    const second = (
      await wsApi(
        ctx,
        team.owner,
        "GET",
        team.workspaceId,
        `/analytics/unanswered?period=7&propertyId=${house}&cursor=${page.next}`,
      )
    ).json() as UnansweredPage;
    expect(second.items).toHaveLength(1);
    expect(second.next).toBeNull();
    const ids = new Set([...page.items, ...second.items].map((item) => item.traceId));
    expect(ids.size).toBe(21);
    const bad = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/analytics/unanswered?period=7&cursor=not-a-cursor`,
    );
    expect(bad.statusCode).toBe(422);
  });

  it("returns markup as plain text and forgets deleted conversations", async () => {
    const list = (
      await wsApi(
        ctx,
        team.owner,
        "GET",
        team.workspaceId,
        `/analytics/unanswered?period=7&propertyId=${casa}`,
      )
    ).json() as UnansweredPage;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      conversationId: conversations.get(casa),
      propertyId: casa,
      propertyName: "Casa Colibrí",
      text: "¿Hay una farmacia <b>cerca</b>? <script>alert(1)</script>",
    });
    const other = await createProperty("Casa efímera");
    await question(other, noonAgo(1), "held", { reason: "not_confident", text: "Se borrará" });
    await db.query(`DELETE FROM conversation WHERE id = $1`, [conversations.get(other)]);
    const after = (
      await wsApi(
        ctx,
        team.owner,
        "GET",
        team.workspaceId,
        `/analytics/unanswered?period=7&propertyId=${other}`,
      )
    ).json() as UnansweredPage;
    expect(after.items).toEqual([]);
  });
});

describe("workspace comparison (feature 010 US3)", () => {
  it("sums property rows into totals, keeps removed properties with activity, and computes from totals", async () => {
    const s = await summaryOf("period=7");
    expect(s.scope).toEqual({ kind: "workspace" });
    expect(s.period.utcFallback).toBe(true);
    const rows = s.properties!;
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get("Casa Colibrí")).toMatchObject({
      removed: false,
      views: 15,
      questions: 7,
      automatic: 4,
      escalated: 2,
      requests: 2,
      clicks: 4,
    });
    expect(byName.get("Casa retirada")).toMatchObject({ removed: true, views: 1 });
    expect(byName.has("Casa vacía")).toBe(false);
    const sum = (key: "views" | "questions" | "automatic" | "requests" | "clicks") =>
      rows.reduce((total, row) => total + row[key], 0);
    expect(s.views.property.current + s.views.stay.current).toBe(sum("views"));
    expect(s.questions.total.current).toBe(sum("questions"));
    expect(s.questions.automatic.current).toBe(sum("automatic"));
    expect(s.requests.made.current).toBe(sum("requests"));
    expect(s.explore.clicks.reduce((total, row) => total + row.count, 0)).toBe(sum("clicks"));
  });
});

describe("Explore and add-ons (feature 010 US4)", () => {
  it("counts Explore opens, clicks per partner, requests by status, and stays with a request", async () => {
    const s = await summaryOf(`period=7&propertyId=${casa}`);
    expect(s.explore).toEqual({
      opens: { current: 6, previous: 2 },
      clicks: [
        { partner: "viator", count: 3 },
        { partner: "civitatis", count: 1 },
      ],
    });
    expect(s.requests).toEqual({
      made: { current: 2, previous: 1 },
      byStatus: [
        { status: "waiting", count: 2 },
        { status: "confirmed", count: 1 },
      ],
      staysWithRequest: 2,
    });
    expect(JSON.stringify(s)).not.toMatch(/commission|amount|price/i);
  });
});
