import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { sql } from "drizzle-orm";
import { PLANS } from "@guidesk/domain";
import { createDb, PLAN_VALUES, type DbHandle } from "../../src/index.js";
import {
  addTopUp,
  correctTopUp,
  formatPlanReport,
  formatTopUps,
  listTopUps,
  parseCustomLimit,
  parseFeePercent,
  parseTopUpReplies,
  setPlan,
  showPlan,
} from "../../src/plans/admin.js";
import { takeTopUpReply, topUpBalance } from "../../src/plan-limits.js";

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
        aiReplies: { limit: 500, source: "plan", perProperty: 300, minimum: 500 },
      },
      usage: { properties: 1, members: 1, pending: 0, aiReplies: 42 },
      month: { resetsAt: "2031-03-01T00:00:00.000Z" },
    });
    const text = formatPlanReport(report);
    expect(text).toContain("Plan: pro");
    expect(text).toContain("Properties: 1 of unlimited (plan)");
    expect(text).toContain("Seats: 1 of 7 (custom");
    expect(text).toContain(
      "AI replies this month: 42 of 500 (plan, 300 per active property, at least 500)",
    );
    expect(text).toContain("Top-ups: 0 replies left");
  });
});

async function topUpEvents(workspaceId: string) {
  const result = await handle.db.execute<{
    type: string;
    actor_user_id: string | null;
    metadata: Record<string, unknown>;
  }>(sql`
    SELECT type, actor_user_id, metadata FROM security_event
     WHERE workspace_id = ${workspaceId} AND type LIKE 'workspace.ai_top_up_%'
     ORDER BY occurred_at, id`);
  return result.rows;
}

describe("top-ups (feature 019 US3)", () => {
  it("adds a top-up valid 12 months, logged as Guidesk with counts only", async () => {
    const ws = await workspace();
    const row = await addTopUp(handle.db, { workspaceId: ws, replies: 250, note: "Piloto Ana" });
    expect(row).toMatchObject({ granted: 250, used: 0, remaining: 250, note: "Piloto Ana" });
    const months =
      (new Date(row.expiresAt).getTime() - new Date(row.addedAt).getTime()) / (24 * 3600 * 1000);
    expect(months).toBeGreaterThan(364);
    expect(months).toBeLessThan(367);
    const [event] = await topUpEvents(ws);
    expect(event).toMatchObject({
      type: "workspace.ai_top_up_added",
      actor_user_id: null,
      metadata: { replies: 250, expiresOn: row.expiresAt.slice(0, 10) },
    });
    expect(JSON.stringify(event?.metadata)).not.toContain("Piloto");
    expect(await topUpBalance(handle.db, ws)).toBe(250);
    const report = await showPlan(handle.db, ws);
    expect(report.topUps.balance).toBe(250);
    expect(formatPlanReport(report)).toContain("Top-ups: 250 replies left");
    expect(formatTopUps(await listTopUps(handle.db, ws))).toContain("250 of 250 left");
  });

  it("needs --yes above 5,000 replies and refuses bad input without changes", async () => {
    const ws = await workspace();
    await expect(
      addTopUp(handle.db, { workspaceId: ws, replies: 5001, note: "Mucho" }),
    ).rejects.toThrow("--yes");
    await expect(addTopUp(handle.db, { workspaceId: ws, replies: 10, note: "  " })).rejects.toThrow(
      "--note",
    );
    await expect(
      addTopUp(handle.db, { workspaceId: randomUUID(), replies: 10, note: "Nadie" }),
    ).rejects.toThrow("No workspace");
    expect(await listTopUps(handle.db, ws)).toEqual([]);
    const big = await addTopUp(handle.db, {
      workspaceId: ws,
      replies: 5001,
      note: "Confirmado",
      confirmed: true,
    });
    expect(big.granted).toBe(5001);
    expect(() => parseTopUpReplies("0")).toThrow("--replies");
    expect(() => parseTopUpReplies("100001")).toThrow("--replies");
    expect(() => parseTopUpReplies("2.5")).toThrow("--replies");
    expect(parseTopUpReplies("250")).toBe(250);
  });

  it("corrects only downward and logs the counts", async () => {
    const ws = await workspace();
    const row = await addTopUp(handle.db, {
      workspaceId: ws,
      replies: 25000,
      note: "Error",
      confirmed: true,
    });
    expect(await takeTopUpReply(handle.db, ws)).toBe(row.id);
    await expect(
      correctTopUp(handle.db, { topUpId: row.id, remaining: 24999, note: "Igual" }),
    ).rejects.toThrow("only lowers");
    const fixed = await correctTopUp(handle.db, {
      topUpId: row.id,
      remaining: 249,
      note: "Eran 250",
    });
    expect(fixed).toMatchObject({
      granted: 250,
      used: 1,
      remaining: 249,
      correctionNote: "Eran 250",
    });
    const corrected = (await topUpEvents(ws)).find(
      (event) => event.type === "workspace.ai_top_up_corrected",
    );
    expect(corrected?.metadata).toEqual({ from: 24999, to: 249 });
  });

  it("takes replies oldest first, skips expired ones, and never goes below zero", async () => {
    const ws = await workspace();
    const expired = await addTopUp(handle.db, { workspaceId: ws, replies: 5, note: "Vieja" });
    await handle.db.execute(sql`
      UPDATE ai_top_up SET created_at = now() - interval '13 months',
                           expires_at = now() - interval '1 month'
       WHERE id = ${expired.id}`);
    const older = await addTopUp(handle.db, { workspaceId: ws, replies: 1, note: "Primera" });
    await handle.db.execute(
      sql`UPDATE ai_top_up SET created_at = now() - interval '1 day' WHERE id = ${older.id}`,
    );
    const newer = await addTopUp(handle.db, { workspaceId: ws, replies: 1, note: "Segunda" });
    expect(await topUpBalance(handle.db, ws)).toBe(2);
    expect(await takeTopUpReply(handle.db, ws)).toBe(older.id);
    expect(await takeTopUpReply(handle.db, ws)).toBe(newer.id);
    expect(await takeTopUpReply(handle.db, ws)).toBeNull();
    expect(await topUpBalance(handle.db, ws)).toBe(0);
  });

  it("lets exactly one of 50 concurrent takes use the last reply (SC-002)", async () => {
    const concurrent = createDb(inject("databaseUrl"), { max: 20 });
    try {
      const ws = await workspace();
      const row = await addTopUp(handle.db, { workspaceId: ws, replies: 1, note: "Última" });
      const results = await Promise.all(
        Array.from({ length: 50 }, () => concurrent.db.transaction((tx) => takeTopUpReply(tx, ws))),
      );
      expect(results.filter((id) => id === row.id)).toHaveLength(1);
      const used = await handle.db.execute<{ replies_used: number }>(
        sql`SELECT replies_used FROM ai_top_up WHERE id = ${row.id}`,
      );
      expect(Number(used.rows[0]!.replies_used)).toBe(1);
    } finally {
      await concurrent.pool.end();
    }
  });
});
