import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  agentTrace,
  conversation,
  createDb,
  property,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import { AGENT_COST_BUDGET_MICROS, runAgentCostCheck } from "../../src/jobs/agent-cost-check.js";

/**
 * The daily cost check (feature 005 US6, T040, FR-032): the 7-day average cost per assistant
 * output that used the model, with an alert above $0.10. Outputs without a model and older
 * traces don't count. Fictional data.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
});

afterAll(async () => {
  await handle.pool.end();
});

async function seed(costs: (number | null)[], oldCost?: number): Promise<string> {
  const db = handle.db;
  const ownerId = `owner-${randomUUID()}`;
  const workspaceId = randomUUID();
  await db.insert(user).values({ id: ownerId, name: "Ana", email: `${ownerId}@example.com` });
  await db.insert(workspace).values({ id: workspaceId, name: "Espacio", createdBy: ownerId });
  const [prop] = await db
    .insert(property)
    .values({
      workspaceId,
      name: "Casa",
      guideLanguages: ["es"],
      setupStatus: "ready",
      source: "manual",
      createdBy: ownerId,
    })
    .returning({ id: property.id });
  const [conv] = await db
    .insert(conversation)
    .values({ workspaceId, propertyId: prop!.id, cookieHash: "a".repeat(64), language: "es" })
    .returning({ id: conversation.id });
  const row = (cost: number | null) => ({
    workspaceId,
    conversationId: conv!.id,
    decision: "answered" as const,
    autonomy: "auto" as const,
    model: cost === null ? null : "claude-opus-5-5",
    costUsdMicros: cost ?? 0,
  });
  if (costs.length) await db.insert(agentTrace).values(costs.map(row));
  if (oldCost !== undefined) {
    await db
      .insert(agentTrace)
      .values({ ...row(oldCost), createdAt: sql`now() - interval '8 days'` });
  }
  return workspaceId;
}

describe("agent cost check (feature 005 FR-032)", () => {
  it("stays quiet at or under $0.10 on average, ignoring outputs without a model and old ones", async () => {
    const workspaceId = await seed([80_000, 120_000, null, null], 900_000);
    const alerts: unknown[] = [];
    const report = await runAgentCostCheck(handle.db, (...args) => alerts.push(args), workspaceId);
    expect(report).toEqual({ replies: 2, averageMicros: 100_000, overBudget: false });
    expect(alerts).toEqual([]);
  });

  it("alerts above $0.10 with numbers only", async () => {
    const workspaceId = await seed([150_000, 90_000]);
    const alerts: [string, Record<string, unknown>][] = [];
    const report = await runAgentCostCheck(
      handle.db,
      (name, tags) => alerts.push([name, tags]),
      workspaceId,
    );
    expect(report.overBudget).toBe(true);
    expect(alerts).toEqual([
      [
        "agent.cost_over_budget",
        { averageMicros: 120_000, budgetMicros: AGENT_COST_BUDGET_MICROS, replies: 2 },
      ],
    ]);
  });

  it("reports nothing to average when there were no model calls", async () => {
    const workspaceId = await seed([]);
    expect(await runAgentCostCheck(handle.db, () => undefined, workspaceId)).toEqual({
      replies: 0,
      averageMicros: 0,
      overBudget: false,
    });
  });
});
