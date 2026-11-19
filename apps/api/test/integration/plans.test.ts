import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { PlanSummary } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * GET plan (feature 011 US4, T016): owners and admins read the plan, each limit with its source and
 * usage, the renewal moment, and the contact; agents are refused and logged; the query is strict;
 * there is no way to write a plan through the API. Synthetic data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"), { PLAN_CONTACT_EMAIL: "planes@example.com" });
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "plans");
});

afterAll(async () => {
  delete process.env.PLAN_CONTACT_EMAIL;
  await db.close();
  await ctx.app.close();
});

async function insertProperty(workspaceId: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO property (workspace_id, name, guide_languages, setup_status, source)
     VALUES ($1, $2, '{es}', 'needs_details', 'manual') RETURNING id`,
    [workspaceId, `Casa ${randomUUID().slice(0, 8)}`],
  );
  return rows[0]!.id;
}

async function usedThisMonth(workspaceId: string, propertyId: string, replies: number) {
  await db.query(
    `INSERT INTO chat_usage_daily (workspace_id, property_id, day, replies)
     VALUES ($1, $2, date_trunc('month', now() AT TIME ZONE 'utc')::date, $3)
     ON CONFLICT (property_id, day) DO UPDATE SET replies = $3`,
    [workspaceId, propertyId, replies],
  );
}

const read = async (member = team.owner) => {
  const response = await wsApi(ctx, member, "GET", team.workspaceId, "/plan");
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as PlanSummary;
};

describe("GET plan (FR-014)", () => {
  it("shows a Free workspace's limits, usage, renewal, and contact", async () => {
    // seedTeam gave the workspace 10 team seats as a custom limit (test helper).
    const propertyId = await insertProperty(team.workspaceId);
    await usedThisMonth(team.workspaceId, propertyId, 85);
    // Usage of last month does not count.
    await db.query(
      `INSERT INTO chat_usage_daily (workspace_id, property_id, day, replies)
       VALUES ($1, $2, (date_trunc('month', now() AT TIME ZONE 'utc') - interval '1 day')::date, 40)`,
      [team.workspaceId, propertyId],
    );
    const summary = await read();
    expect(summary).toMatchObject({
      workspaceId: team.workspaceId,
      plan: "free",
      changedAt: null,
      contactEmail: "planes@example.com",
      limits: {
        properties: { limit: 2, used: 1, source: "plan" },
        seats: { limit: 10, used: 3, members: 3, pending: 0, source: "custom" },
        aiReplies: { limit: 100, used: 85, source: "plan", perProperty: null },
      },
    });
    const start = new Date(summary.limits.aiReplies.monthStart);
    const resets = new Date(summary.limits.aiReplies.resetsAt);
    expect(start.getUTCDate()).toBe(1);
    expect(resets.getUTCDate()).toBe(1);
    expect(resets.getTime()).toBeGreaterThan(Date.now());
    expect((await read(team.admin)).plan).toBe("free");
  });

  it("shows unlimited and pooled limits on Business, and custom AI limits", async () => {
    await db.query(
      `UPDATE workspace SET plan = 'business', seat_limit = NULL, plan_changed_at = now() WHERE id = $1`,
      [team.workspaceId],
    );
    await insertProperty(team.workspaceId);
    const business = await read();
    expect(business.plan).toBe("business");
    expect(business.changedAt).not.toBeNull();
    expect(business.limits.properties).toEqual({ limit: null, used: 2, source: "plan" });
    expect(business.limits.seats).toMatchObject({ limit: null, used: 3 });
    expect(business.limits.aiReplies).toMatchObject({ limit: 600, perProperty: 300 });

    await db.query(`UPDATE workspace SET ai_reply_monthly_limit = 50 WHERE id = $1`, [
      team.workspaceId,
    ]);
    expect((await read()).limits.aiReplies).toMatchObject({
      limit: 50,
      source: "custom",
      perProperty: null,
    });
    await db.query(
      `UPDATE workspace SET plan = 'free', seat_limit = 10, ai_reply_monthly_limit = NULL WHERE id = $1`,
      [team.workspaceId],
    );
  });

  it("refuses agents with a logged denial, and any query parameter", async () => {
    const refused = await wsApi(ctx, team.agent, "GET", team.workspaceId, "/plan");
    expect(refused.statusCode).toBe(403);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM security_event
        WHERE type = 'access.role_denied' AND workspace_id = $1 AND actor_user_id = $2`,
      [team.workspaceId, team.agent.userId],
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
    const extra = await wsApi(ctx, team.owner, "GET", team.workspaceId, "/plan?plan=business");
    expect(extra.statusCode).toBe(422);
  });

  it("has no way to change the plan through the API (AC-SEC-002)", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const response = await wsApi(ctx, team.owner, method, team.workspaceId, "/plan", {
        plan: "business",
        seatLimit: 99,
      });
      expect(response.statusCode, method).toBeGreaterThanOrEqual(400);
    }
    const renamed = await wsApi(ctx, team.owner, "PATCH", team.workspaceId, "", {
      name: "Hospedajes Plan",
      plan: "business",
      propertyLimit: 99,
    });
    expect(renamed.statusCode).toBeGreaterThanOrEqual(400);
    const { rows } = await db.query<{ plan: string; property_limit: number | null }>(
      `SELECT plan, property_limit FROM workspace WHERE id = $1`,
      [team.workspaceId],
    );
    expect(rows[0]).toEqual({ plan: "free", property_limit: null });
  });
});
