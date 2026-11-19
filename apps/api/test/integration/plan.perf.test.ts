import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery } from "./helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Plan timing (feature 011 T022, plan Performance Budget): a Pro workspace with 50 properties, a
 * full month of daily AI usage per property (and the month before), members and invitations. GET
 * plan answers within p95 ≤ 300 ms over 20 requests. Synthetic data only.
 */
const RUNS = 20;
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "plan-perf");
  const ws = team.workspaceId;
  await db.query(`UPDATE workspace SET plan = 'pro' WHERE id = $1`, [ws]);
  await db.query(
    `INSERT INTO property (workspace_id, name, guide_languages, setup_status, source)
     SELECT $1, 'Casa ' || n, ARRAY['es'], 'ready', 'manual' FROM generate_series(1, 50) AS n`,
    [ws],
  );
  await db.query(
    `INSERT INTO chat_usage_daily (workspace_id, property_id, day, replies, cost_usd_micros)
     SELECT $1, p.id, (now() AT TIME ZONE 'utc')::date - d, 5 + d % 7, 2000
       FROM property p, generate_series(0, 59) AS d
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

describe("Plan timing (feature 011 plan)", () => {
  it("answers GET plan within budget", async () => {
    const timings: number[] = [];
    for (let index = 0; index < RUNS; index += 1) {
      const started = performance.now();
      const response = await wsApi(ctx, team.owner, "GET", team.workspaceId, "/plan");
      timings.push(performance.now() - started);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ limits: { aiReplies: { limit: 15_000 } } });
    }
    expect(p95(timings)).toBeLessThanOrEqual(300);
  });
});
