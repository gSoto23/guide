import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, type DbHandle } from "../../src/index.js";
import { formatPilotMetrics, pilotMetrics } from "../../src/reports/pilot.js";

/**
 * The founder's pilot report (feature 010 T018, research R11): each metric over a sign-up cohort,
 * and an output with no names, emails, or IDs. The cohort sits in March 2025 so other tests' users
 * never fall in it. Fictional data only.
 */
let handle: DbHandle;
const FROM = "2025-03-03";
const TO = "2025-03-04";
const NOW = new Date("2025-06-30T12:00:00Z");
const names: string[] = [];
const ids: string[] = [];

interface Host {
  userId: string;
  workspaceId: string;
  propertyId: string;
}

async function host(
  index: number,
  signUp: string,
  options: { publishAfterMinutes?: number; openOnDay?: number } = {},
): Promise<Host> {
  const db = handle.db;
  const userId = `pilot-${randomUUID()}`;
  const workspaceId = randomUUID();
  const name = `Anfitriona Piloto ${index}`;
  names.push(name, `${userId}@example.com`, `Espacio Piloto ${index}`, `Casa Piloto ${index}`);
  ids.push(userId, workspaceId);
  await db.execute(sql`
    INSERT INTO "user" (id, name, email, created_at)
    VALUES (${userId}, ${name}, ${`${userId}@example.com`}, ${signUp}::timestamptz)`);
  await db.execute(sql`
    INSERT INTO workspace (id, name, created_by, created_at)
    VALUES (${workspaceId}, ${`Espacio Piloto ${index}`}, ${userId}, ${signUp}::timestamptz)`);
  await db.execute(sql`
    INSERT INTO membership (workspace_id, user_id, role) VALUES (${workspaceId}, ${userId}, 'owner')`);
  const property = await db.execute<{ id: string }>(sql`
    INSERT INTO property (workspace_id, name, guide_languages, setup_status, source, created_by)
    VALUES (${workspaceId}, ${`Casa Piloto ${index}`}, ARRAY['es'], 'ready', 'manual', ${userId})
    RETURNING id`);
  const propertyId = property.rows[0]!.id;
  ids.push(propertyId);
  if (options.publishAfterMinutes !== undefined) {
    const guide = await db.execute<{ id: string }>(sql`
      INSERT INTO guide (workspace_id, property_id) VALUES (${workspaceId}, ${propertyId}) RETURNING id`);
    await db.execute(sql`
      INSERT INTO guide_version (workspace_id, guide_id, number, cause, snapshot, snapshot_schema,
        languages, published_by, published_at)
      VALUES (${workspaceId}, ${guide.rows[0]!.id}, 1, 'publish', '{"schema":1,"languages":["es"],"sections":[]}',
        1, ARRAY['es'], ${userId},
        ${signUp}::timestamptz + make_interval(mins => ${options.publishAfterMinutes}))`);
  }
  if (options.openOnDay !== undefined) {
    await db.execute(sql`
      INSERT INTO guide_open_daily (workspace_id, property_id, day, link_kind, opens)
      VALUES (${workspaceId}, ${propertyId}, (${signUp}::timestamptz + make_interval(days => ${options.openOnDay}))::date, 'property', 3)`);
  }
  return { userId, workspaceId, propertyId };
}

async function questions(h: Host, decisions: string[], costMicros = 0): Promise<void> {
  const conversation = await handle.db.execute<{ id: string }>(sql`
    INSERT INTO conversation (workspace_id, property_id, cookie_hash, language)
    VALUES (${h.workspaceId}, ${h.propertyId}, md5(random()::text) || md5(random()::text), 'es')
    RETURNING id`);
  for (const decision of decisions) {
    await handle.db.execute(sql`
      INSERT INTO agent_trace (workspace_id, conversation_id, decision, autonomy, cost_usd_micros)
      VALUES (${h.workspaceId}, ${conversation.rows[0]!.id}, ${decision}, 'auto', ${costMicros})`);
  }
}

async function stays(h: Host, opened: number, withRequest: number): Promise<void> {
  for (let i = 0; i < opened; i += 1) {
    const stay = await handle.db.execute<{ id: string }>(sql`
      INSERT INTO stay (workspace_id, property_id, source, check_in_date, checkout_date, channel, guide_opened_at)
      VALUES (${h.workspaceId}, ${h.propertyId}, 'manual', '2025-03-10', '2025-03-12', 'Directo', '2025-03-10T15:00:00Z')
      RETURNING id`);
    if (i >= withRequest) continue;
    await handle.db.execute(sql`
      INSERT INTO service_request (workspace_id, property_id, stay_id, extra_name, source_language,
        price, currency, status, expires_at)
      VALUES (${h.workspaceId}, ${h.propertyId}, ${stay.rows[0]!.id}, '{"es": "Recogida"}', 'es', 85, 'USD',
        'confirmed', '2025-03-11T00:00:00Z')`);
  }
}

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
  // Activated: published after 20 minutes, opened on day 2; retained by a sign-in on day 55.
  const ana = await host(1, "2025-03-03T14:00:00Z", { publishAfterMinutes: 20, openOnDay: 2 });
  // Published after 40 minutes, first opened on day 9 (too late), not retained.
  const beto = await host(2, "2025-03-03T16:00:00Z", { publishAfterMinutes: 40, openOnDay: 9 });
  // Never published; retained through a session refresh on day 58.
  const carla = await host(3, "2025-03-04T10:00:00Z");
  // Signed up outside the cohort.
  const outside = await host(4, "2025-03-06T10:00:00Z", { publishAfterMinutes: 5, openOnDay: 1 });
  await handle.db.execute(sql`
    INSERT INTO security_event (occurred_at, type, outcome, actor_user_id)
    VALUES ('2025-04-27T14:00:00Z', 'signin.succeeded', 'success', ${ana.userId})`);
  await handle.db.execute(sql`
    INSERT INTO "session" (id, token, user_id, expires_at, created_at, updated_at)
    VALUES (${randomUUID()}, ${randomUUID()}, ${carla.userId}, '2025-06-01T00:00:00Z',
      '2025-04-30T10:00:00Z', '2025-05-01T10:00:00Z')`);
  // 3 answered, 1 pointer, 1 drafted, 1 held, 1 greeting (not a question): 4 of 6 automatic.
  await questions(ana, ["answered", "answered", "pointer", "drafted", "held", "greeting"], 2_000);
  await questions(beto, ["answered"], 1_000);
  await questions(outside, ["held", "held"], 50_000);
  await handle.db.execute(sql`
    INSERT INTO guide_ai_request (workspace_id, kind, model, cost_usd_micros, outcome)
    VALUES (${beto.workspaceId}, 'draft_listing', 'claude-test', 5000, 'ok')`);
  await stays(ana, 4, 1);
  await stays(beto, 1, 0);
  await stays(outside, 5, 5);

  // Feature 014: demo workspaces change nothing. One account in the cohort owns only a demo
  // workspace with full activity, and ana also owns a demo workspace with activity.
  const demoOnly = await host(5, "2025-03-03T18:00:00Z", { publishAfterMinutes: 1, openOnDay: 0 });
  await handle.db.execute(sql`UPDATE workspace SET demo = true WHERE id = ${demoOnly.workspaceId}`);
  await questions(demoOnly, ["answered", "answered"], 90_000);
  await stays(demoOnly, 3, 3);
  const anaDemoId = randomUUID();
  ids.push(anaDemoId);
  await handle.db.execute(sql`
    INSERT INTO workspace (id, name, created_by, created_at, demo)
    VALUES (${anaDemoId}, 'Demo · Guidesk', ${ana.userId}, '2025-03-03T15:00:00Z', true)`);
  await handle.db.execute(sql`
    INSERT INTO membership (workspace_id, user_id, role) VALUES (${anaDemoId}, ${ana.userId}, 'owner')`);
  const anaDemoProperty = await handle.db.execute<{ id: string }>(sql`
    INSERT INTO property (workspace_id, name, guide_languages, setup_status, source, created_by)
    VALUES (${anaDemoId}, 'Casa Demo', ARRAY['es'], 'ready', 'manual', ${ana.userId}) RETURNING id`);
  const anaDemo: Host = {
    userId: ana.userId,
    workspaceId: anaDemoId,
    propertyId: anaDemoProperty.rows[0]!.id,
  };
  await questions(anaDemo, ["held", "held", "held"], 70_000);
  await stays(anaDemo, 6, 6);
});

afterAll(async () => {
  await handle.pool.end();
});

describe("pilot metrics (feature 010 US5)", () => {
  // Feature 014 AC-SEC-004: the demo workspaces added in beforeAll leave every number unchanged.
  it("computes each metric for the cohort only, leaving demo workspaces out", async () => {
    const m = await pilotMetrics(handle.db, { from: FROM, to: TO }, NOW);
    expect(m.cohort).toEqual({ from: FROM, to: TO, signUps: 3 });
    expect(m.activation).toMatchObject({ numerator: 1, denominator: 3 });
    expect(m.timeToGuideMinutes).toMatchObject({ median: 30, published: 2 });
    // ana 3 automatic of 5 questions, beto 1 of 1: 4 of 6; greetings and other cohorts excluded.
    expect(m.automatedResolution).toMatchObject({ numerator: 4, denominator: 6 });
    expect(m.attachRate).toMatchObject({ numerator: 1, denominator: 5, value: 0.2 });
    expect(m.retentionDay60).toMatchObject({ numerator: 2, denominator: 3 });
    // (2,000 × 6 + 1,000 + 5,000) micros = US$0.018 over 5 stays.
    expect(m.aiCostPerStay.totalUsd).toBeCloseTo(0.018, 6);
    expect(m.aiCostPerStay.staysServed).toBe(5);
    expect(m.aiCostPerStay.perStayUsd).toBeCloseTo(0.0036, 6);
  });

  it("counts nobody as retained before day 60 has passed", async () => {
    const early = await pilotMetrics(
      handle.db,
      { from: FROM, to: TO },
      new Date("2025-04-20T00:00:00Z"),
    );
    expect(early.retentionDay60).toEqual({
      numerator: 0,
      denominator: 0,
      value: null,
      target: "≥ 70%",
    });
  });

  it("prints aggregates without names, emails, or IDs", async () => {
    const m = await pilotMetrics(handle.db, { from: FROM, to: TO }, NOW);
    const text = `${formatPilotMetrics(m)}\n${JSON.stringify(m)}`;
    expect(text).toContain("Activation");
    expect(text).toContain("33.3% (1/3)");
    for (const value of [...names, ...ids]) expect(text).not.toContain(value);
    expect(text).not.toMatch(/@/);
  });
});
