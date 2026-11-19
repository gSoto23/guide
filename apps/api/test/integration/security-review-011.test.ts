import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery } from "./helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Security review for feature 011 (T021). AC-SEC-001 is in cross-tenant.test.ts; AC-SEC-002 and
 * AC-SEC-003 in plans.test.ts too; AC-SEC-004 in plan-limits.test.ts (10 racing creations and
 * invitations); AC-SEC-005 in the worker's plan-limits.test.ts (no model call at the limit). This
 * file checks the database side of AC-SEC-002 and that plan details never reach agents or the
 * founder's note any member. Synthetic data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "secreview011");
  await db.query(`UPDATE workspace SET plan_note = 'Piloto: socio de diseño' WHERE id = $1`, [
    team.workspaceId,
  ]);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

describe("feature 011 security review", () => {
  it("AC-SEC-002: the app role cannot write a plan or a custom limit, even under RLS", async () => {
    for (const column of ["plan", "seat_limit", "property_limit", "ai_reply_monthly_limit"]) {
      const { rows } = await db.query<{ allowed: boolean }>(
        `SELECT has_column_privilege('guidesk_app', 'workspace', $1, 'UPDATE') AS allowed`,
        [column],
      );
      expect(rows[0]!.allowed, column).toBe(false);
    }
    const notices = await db.query<{ allowed: boolean }>(
      `SELECT has_table_privilege('guidesk_app', 'plan_usage_notice', 'SELECT') AS allowed`,
    );
    expect(notices.rows[0]!.allowed).toBe(false);
  });

  it("AC-SEC-003: agents get no plan details, and no member gets the founder's note", async () => {
    const agent = await wsApi(ctx, team.agent, "GET", team.workspaceId, "/plan");
    expect(agent.statusCode).toBe(403);
    expect(agent.body).not.toContain("free");
    const owner = await wsApi(ctx, team.owner, "GET", team.workspaceId, "/plan");
    expect(owner.statusCode).toBe(200);
    expect(owner.body).not.toContain("Piloto");
    const me = await wsApi(ctx, team.owner, "GET", team.workspaceId, "");
    expect(me.body).not.toContain("Piloto");
  });
});
