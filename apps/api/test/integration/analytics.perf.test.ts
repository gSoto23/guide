import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery } from "./helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Analytics timings (feature 010 T022, plan Performance Budget): a workspace with 50 properties and
 * 180 days of opens, questions (3 a day per property, 27,000 traces), stays, Explore counts, and request
 * counts. The 90-day summary for the workspace and a property answers within p95 ≤ 500 ms, and the
 * unanswered list within p95 ≤ 300 ms, over 20 requests each. Synthetic data only.
 */
const RUNS = 20;
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let firstProperty = "";

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "analytics-perf");
  const ws = team.workspaceId;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO property (workspace_id, name, guide_languages, setup_status, source, country, time_zone)
     SELECT $1, 'Casa ' || n, ARRAY['es'], 'ready', 'manual', 'CR',
            CASE WHEN n % 5 = 0 THEN NULL ELSE 'America/Costa_Rica' END
       FROM generate_series(1, 50) AS n
     RETURNING id`,
    [ws],
  );
  firstProperty = rows[0]!.id;
  await db.query(
    `INSERT INTO guide_open_daily (workspace_id, property_id, day, link_kind, opens)
     SELECT $1, p.id, current_date - d, k, 1 + d % 7
       FROM property p, generate_series(0, 179) AS d, unnest(ARRAY['property', 'stay']) AS k
      WHERE p.workspace_id = $1`,
    [ws],
  );
  await db.query(
    `INSERT INTO conversation (workspace_id, property_id, cookie_hash, language)
     SELECT $1, p.id, md5(p.id::text) || md5(p.id::text || 'x'), 'es'
       FROM property p WHERE p.workspace_id = $1`,
    [ws],
  );
  await db.query(
    `INSERT INTO chat_message (workspace_id, conversation_id, seq, author, body, created_at)
     SELECT $1, c.id, d * 3 + q, 'guest', 'Pregunta de prueba ' || d || '-' || q,
            now() - make_interval(days => d, hours => q)
       FROM conversation c, generate_series(0, 179) AS d, generate_series(0, 2) AS q
      WHERE c.workspace_id = $1`,
    [ws],
  );
  await db.query(
    `INSERT INTO agent_trace (workspace_id, conversation_id, guest_message_id, classification,
       decision, reason, autonomy, created_at)
     SELECT $1, m.conversation_id, m.id,
            jsonb_build_object('topic', (ARRAY['wifi', 'arrival', 'parking', 'checkout'])[1 + m.seq % 4]),
            (ARRAY['answered', 'answered', 'drafted', 'held', 'pointer'])[1 + m.seq % 5],
            CASE m.seq % 5 WHEN 2 THEN 'draft_ready' WHEN 3 THEN 'not_confident' ELSE NULL END,
            'auto', m.created_at
       FROM chat_message m WHERE m.workspace_id = $1`,
    [ws],
  );
  await db.query(
    `INSERT INTO stay (workspace_id, property_id, source, check_in_date, checkout_date, channel, guide_opened_at)
     SELECT $1, p.id, 'manual', current_date - d, current_date - d + 3, 'Directo', now() - make_interval(days => d)
       FROM property p, generate_series(0, 179, 4) AS d
      WHERE p.workspace_id = $1`,
    [ws],
  );
  await db.query(
    `INSERT INTO explore_open_daily (workspace_id, property_id, day, opens)
     SELECT $1, p.id, current_date - d, 2 FROM property p, generate_series(0, 179) AS d
      WHERE p.workspace_id = $1`,
    [ws],
  );
  await db.query(
    `INSERT INTO service_request_daily (workspace_id, property_id, day, status, count)
     SELECT $1, p.id, current_date - d, s, 1
       FROM property p, generate_series(0, 179, 3) AS d, unnest(ARRAY['waiting', 'confirmed']) AS s
      WHERE p.workspace_id = $1`,
    [ws],
  );
  await db.query(`ANALYZE`);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
}

async function time(path: string): Promise<number> {
  const timings: number[] = [];
  for (let index = 0; index < RUNS; index += 1) {
    const started = performance.now();
    const response = await wsApi(ctx, team.owner, "GET", team.workspaceId, path);
    timings.push(performance.now() - started);
    expect(response.statusCode, response.body).toBe(200);
  }
  return p95(timings);
}

describe("Analytics timings (feature 010 plan)", () => {
  it("answers the workspace and property views and the unanswered list within budget", async () => {
    const traces = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM agent_trace WHERE workspace_id = $1`,
      [team.workspaceId],
    );
    expect(traces.rows[0]!.n).toBe(27_000);
    const workspace = await time("/analytics?period=90");
    const property = await time(`/analytics?period=90&propertyId=${firstProperty}`);
    const unanswered = await time("/analytics/unanswered?period=90");
    expect(workspace).toBeLessThanOrEqual(500);
    expect(property).toBeLessThanOrEqual(500);
    expect(unanswered).toBeLessThanOrEqual(300);
  });
});
