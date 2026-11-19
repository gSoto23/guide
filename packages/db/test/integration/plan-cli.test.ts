import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { sql } from "drizzle-orm";
import { PLANS } from "@guidesk/domain";
import { createDb, PLAN_VALUES, type DbHandle } from "../../src/index.js";
import {
  formatPlanReport,
  parseCustomLimit,
  parseFeePercent,
  setPlan,
  showPlan,
} from "../../src/plans/admin.js";

/**
 * The founder's plan tool (feature 011 US3, T014): plans and custom limits change in one
 * transaction with a security event of short values; the note stays on the workspace; bad input
 * changes nothing; the report shows each limit's source and usage. Fictional data only.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
});

afterAll(async () => {
  await handle.pool.end();
});

async function workspace(): Promise<string> {
  const userId = `plan-${randomUUID()}`;
  const workspaceId = randomUUID();
  await handle.db.execute(sql`
    INSERT INTO "user" (id, name, email) VALUES (${userId}, 'Dueña Plan', ${`${userId}@example.com`})`);
  await handle.db.execute(sql`
    INSERT INTO workspace (id, name, created_by) VALUES (${workspaceId}, 'Espacio Plan', ${userId})`);
  await handle.db.execute(sql`
    INSERT INTO membership (workspace_id, user_id, role) VALUES (${workspaceId}, ${userId}, 'owner')`);
  return workspaceId;
}

async function row(workspaceId: string) {
  const result = await handle.db.execute<{
    plan: string;
    plan_note: string | null;
    plan_changed_at: Date | null;
    property_limit: number | null;
    seat_limit: number | null;
    ai_reply_monthly_limit: number | null;
  }>(sql`
    SELECT plan, plan_note, plan_changed_at, property_limit, seat_limit, ai_reply_monthly_limit
      FROM workspace WHERE id = ${workspaceId}`);
  return result.rows[0]!;
}

async function events(workspaceId: string) {
  const result = await handle.db.execute<{
    actor_user_id: string | null;
    metadata: Record<string, unknown>;
  }>(sql`
    SELECT actor_user_id, metadata FROM security_event
     WHERE workspace_id = ${workspaceId} AND type = 'workspace.plan_changed'
     ORDER BY occurred_at`);
  return result.rows;
}

describe("plan:set (FR-017, FR-018)", () => {
  it("stores the same plans the domain defines", () => {
    expect([...PLAN_VALUES]).toEqual([...PLANS]);
  });

  it("moves a workspace to Business and logs the change as Guidesk, keeping the note off the log", async () => {
    const ws = await workspace();
    const result = await setPlan(handle.db, {
      workspaceId: ws,
      plan: "business",
      note: "Piloto: socia de diseño",
    });
    expect(result).toEqual({
      from: "free",
      to: "business",
      custom: { properties: null, seats: null, aiReplies: null, feeBps: null },
    });
    const stored = await row(ws);
    expect(stored).toMatchObject({ plan: "business", plan_note: "Piloto: socia de diseño" });
    expect(stored.plan_changed_at).not.toBeNull();
    const logged = await events(ws);
    expect(logged).toEqual([
      {
        actor_user_id: null,
        metadata: {
          from: "free",
          to: "business",
          properties: "plan",
          seats: "plan",
          aiReplies: "plan",
          feeBps: "plan",
        },
      },
    ]);
    expect(JSON.stringify(logged)).not.toContain("Piloto");
  });

  it("sets, keeps, and clears custom limits one at a time", async () => {
    const ws = await workspace();
    await setPlan(handle.db, {
      workspaceId: ws,
      plan: "free",
      properties: 5,
      aiReplies: 50,
      note: "Más propiedades",
    });
    expect(await row(ws)).toMatchObject({
      property_limit: 5,
      seat_limit: null,
      ai_reply_monthly_limit: 50,
    });
    // Omitted flags keep the current custom limit; "plan" clears it.
    await setPlan(handle.db, { workspaceId: ws, plan: "pro", aiReplies: "plan", note: "Pro" });
    expect(await row(ws)).toMatchObject({
      plan: "pro",
      property_limit: 5,
      ai_reply_monthly_limit: null,
    });
    expect((await events(ws)).at(-1)!.metadata).toEqual({
      from: "free",
      to: "pro",
      properties: 5,
      seats: "plan",
      aiReplies: "plan",
      feeBps: "plan",
    });
  });

  it("sets a custom platform fee and clears it (feature 013 FR-021)", async () => {
    const ws = await workspace();
    expect(parseFeePercent("4")).toBe(400);
    expect(parseFeePercent("7.5")).toBe(750);
    expect(parseFeePercent("plan")).toBe("plan");
    expect(() => parseFeePercent("31")).toThrow("--fee-percent");
    expect(() => parseFeePercent("-1")).toThrow("--fee-percent");
    await setPlan(handle.db, { workspaceId: ws, plan: "business", feeBps: 400, note: "Negociado" });
    const fee = await handle.db.execute<{ platform_fee_bps: number | null }>(
      sql`SELECT platform_fee_bps FROM workspace WHERE id = ${ws}`,
    );
    expect(fee.rows[0]!.platform_fee_bps).toBe(400);
    expect((await events(ws)).at(-1)!.metadata).toMatchObject({ feeBps: 400 });
    await setPlan(handle.db, { workspaceId: ws, plan: "business", feeBps: "plan", note: "Plan" });
    const cleared = await handle.db.execute<{ platform_fee_bps: number | null }>(
      sql`SELECT platform_fee_bps FROM workspace WHERE id = ${ws}`,
    );
    expect(cleared.rows[0]!.platform_fee_bps).toBeNull();
  });

  it("changes nothing on bad input", async () => {
    const ws = await workspace();
    await expect(
      setPlan(handle.db, { workspaceId: randomUUID(), plan: "pro", note: "x" }),
    ).rejects.toThrow("No workspace with that ID.");
    await expect(
      setPlan(handle.db, { workspaceId: "nope", plan: "pro", note: "x" }),
    ).rejects.toThrow("UUID");
    await expect(
      setPlan(handle.db, { workspaceId: ws, plan: "enterprise", note: "x" }),
    ).rejects.toThrow("free, pro, or business");
    await expect(setPlan(handle.db, { workspaceId: ws, plan: "pro", note: "  " })).rejects.toThrow(
      "--note",
    );
    await expect(
      setPlan(handle.db, { workspaceId: ws, plan: "pro", seats: 0, note: "x" }),
    ).rejects.toThrow("whole numbers");
    expect(() => parseCustomLimit("seats", "2.5")).toThrow("--seats");
    expect(() => parseCustomLimit("seats", "-1")).toThrow("--seats");
    expect(parseCustomLimit("seats", "plan")).toBe("plan");
    expect(parseCustomLimit("seats", "4")).toBe(4);
    expect(await row(ws)).toMatchObject({ plan: "free", plan_note: null, seat_limit: null });
    expect(await events(ws)).toEqual([]);
  });
});

describe("plan:show (FR-019)", () => {
  it("prints each limit with its source and this month's usage", async () => {
    const ws = await workspace();
    const property = await handle.db.execute<{ id: string }>(sql`
      INSERT INTO property (workspace_id, name, guide_languages, setup_status, source)
      VALUES (${ws}, 'Casa Plan', ARRAY['es'], 'ready', 'manual') RETURNING id`);
    await handle.db.execute(sql`
      INSERT INTO chat_usage_daily (workspace_id, property_id, day, replies)
      VALUES (${ws}, ${property.rows[0]!.id}, '2031-02-03', 42)`);
    await setPlan(handle.db, { workspaceId: ws, plan: "pro", seats: 7, note: "Equipo grande" });
    const report = await showPlan(handle.db, ws, new Date("2031-02-20T10:00:00Z"));
    expect(report).toMatchObject({
      plan: "pro",
      note: "Equipo grande",
      limits: {
        properties: { limit: null, source: "plan" },
        seats: { limit: 7, source: "custom" },
        aiReplies: { limit: 300, source: "plan", perProperty: 300 },
      },
      usage: { properties: 1, members: 1, pending: 0, aiReplies: 42 },
      month: { resetsAt: "2031-03-01T00:00:00.000Z" },
    });
    const text = formatPlanReport(report);
    expect(text).toContain("Plan: pro");
    expect(text).toContain("Properties: 1 of unlimited (plan)");
    expect(text).toContain("Seats: 1 of 7 (custom");
    expect(text).toContain("AI replies this month: 42 of 300 (plan, 300 per active property)");
  });
});
