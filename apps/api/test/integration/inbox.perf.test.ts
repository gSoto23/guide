import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { InboxPage } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Inbox timings (feature 006 T040, SC-001): with 1,000 open conversations across five properties,
 * each with messages, drafts, traces, and presence, every tab and the property filter answer with
 * p95 under 1 second at the origin over 20 requests each. Fictional data only.
 */
const RUNS = 20;
const CONVERSATIONS = 1000;

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let firstProperty: string;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "inbox-perf");
  const { rows: properties } = await db.query<{ id: string }>(
    `INSERT INTO property (workspace_id, name, guide_languages, setup_status, source)
     SELECT $1, 'Casa ' || n, ARRAY['es'], 'ready', 'manual' FROM generate_series(1, 5) AS n
     RETURNING id`,
    [team.workspaceId],
  );
  firstProperty = properties[0]!.id;
  await db.query(
    `WITH props AS (SELECT array_agg(id ORDER BY name) AS ids FROM property WHERE workspace_id = $1)
     INSERT INTO conversation (workspace_id, property_id, cookie_hash, language, status,
                               needs_host_reason, last_message_at, done_at)
     SELECT $1, props.ids[1 + n % 5], md5(n::text) || md5((n * 7)::text), 'es',
            CASE WHEN n % 10 = 0 THEN 'done' WHEN n % 3 = 0 THEN 'needs_host' ELSE 'open' END,
            CASE WHEN n % 3 = 0 AND n % 10 <> 0
                 THEN (ARRAY['draft_ready', 'emergency', 'not_confident'])[1 + n % 3] END,
            now() - make_interval(mins => n),
            CASE WHEN n % 10 = 0 THEN now() - make_interval(mins => n) END
       FROM generate_series(1, $2::int) AS n, props`,
    [team.workspaceId, CONVERSATIONS],
  );
  await db.query(
    `INSERT INTO chat_message (workspace_id, conversation_id, seq, author, body)
     SELECT c.workspace_id, c.id, s, (ARRAY['guest', 'assistant', 'guest'])[s],
            'Mensaje de prueba número ' || s || ' con texto suficiente para un extracto'
       FROM conversation c, generate_series(1, 3) AS s
      WHERE c.workspace_id = $1`,
    [team.workspaceId],
  );
  // Drafts sent unchanged with their traces, so the trust suggestion query has work to do.
  await db.query(
    `WITH picked AS (
       SELECT id, workspace_id, row_number() OVER (ORDER BY id) AS n
         FROM conversation WHERE workspace_id = $1 LIMIT 300
     ), traces AS (
       INSERT INTO agent_trace (workspace_id, conversation_id, decision, autonomy, classification)
       SELECT workspace_id, id, 'drafted', 'draft',
              jsonb_build_object('topic', (ARRAY['arrival', 'wifi', 'checkout'])[1 + n % 3])
         FROM picked RETURNING id, conversation_id
     )
     INSERT INTO agent_draft (workspace_id, conversation_id, body, status, acted_at, trace_id)
     SELECT $1, t.conversation_id, 'Borrador', 'sent', now() - interval '1 day', t.id FROM traces t`,
    [team.workspaceId],
  );
  await db.query(
    `INSERT INTO conversation_presence (workspace_id, conversation_id, user_id, expires_at)
     SELECT $1, id, $2, now() + interval '30 seconds'
       FROM conversation WHERE workspace_id = $1 AND status = 'needs_host' LIMIT 50`,
    [team.workspaceId, team.agent.userId],
  );
  await db.query("ANALYZE conversation, chat_message, agent_draft, agent_trace");
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

describe("inbox timings (feature 006 SC-001)", () => {
  it("answers every tab and the property filter with p95 under 1 second for 1,000 conversations", async () => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM conversation WHERE workspace_id = $1 AND status <> 'done'`,
      [team.workspaceId],
    );
    expect(rows[0]!.n).toBeGreaterThanOrEqual(900);
    for (const path of [
      "/inbox?tab=needs",
      "/inbox?tab=all",
      "/inbox?tab=done",
      `/inbox?tab=all&propertyId=${firstProperty}`,
      "/inbox?tab=all&before=200",
    ]) {
      const timings: number[] = [];
      for (let index = 0; index < RUNS; index += 1) {
        const started = performance.now();
        const response = await wsApi(ctx, team.owner, "GET", team.workspaceId, path);
        timings.push(performance.now() - started);
        expect(response.statusCode, path).toBe(200);
        const page = response.json() as InboxPage;
        expect(page.items.length, path).toBeGreaterThan(0);
      }
      expect(percentile(timings, 95), path).toBeLessThan(1000);
    }
  });
});
