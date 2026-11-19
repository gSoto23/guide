import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  agentTrace,
  assistantTest,
  chatUsageDaily,
  copilotRun,
  createDb,
  property,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import { runAssistantTest } from "../../src/jobs/assistant-test.js";
import { runCopilotDraft } from "../../src/jobs/copilot-draft.js";
import {
  deps,
  guestSays,
  methods,
  run,
  seed,
  stateOf,
  useChatDb,
  type Seeded,
} from "./chat-helpers.js";

/**
 * Monthly AI replies (feature 011 US1, T006): at the plan's limit the guide chat holds with
 * `monthly_limit`, the copilot and tests end `monthly_limited`, and no model call is made. Usage of
 * earlier months does not count; Pro pools 300 per active property; custom limits replace the
 * plan's. Fictional data only.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

/** Replies recorded on the first day of this UTC month (or `day` when given). */
async function used(
  s: Seeded,
  replies: number,
  day = sql`date_trunc('month', now() AT TIME ZONE 'utc')::date`,
) {
  await handle.db.insert(chatUsageDaily).values({
    workspaceId: s.workspaceId,
    propertyId: s.propertyId,
    day,
    replies,
  });
}

async function onPlan(s: Seeded, values: Partial<typeof workspace.$inferInsert>) {
  await handle.db.update(workspace).set(values).where(eq(workspace.id, s.workspaceId));
}

describe("guide chat at the monthly limit (FR-007)", () => {
  it("holds a Free workspace at 100 replies without a model call and names the monthly limit", async () => {
    const s = await seed({ autonomy: "auto" });
    await used(s, 100);
    const id = await guestSays(s, "¿A qué hora es la salida?");
    const { deps: d, llm, emails } = deps();
    expect(await run(s, d, id)).toBe("held");
    expect(methods(llm)).toEqual([]);
    expect((await stateOf(s)).conv).toEqual({ status: "needs_host", reason: "monthly_limit" });
    const [trace] = await handle.db
      .select({ reason: agentTrace.reason })
      .from(agentTrace)
      .where(eq(agentTrace.conversationId, s.conversationId));
    expect(trace?.reason).toBe("monthly_limit");
    // The daily notice is for the daily budgets only; the monthly emails come from plan-usage.tick.
    expect(emails.filter((email) => email.template === "chat.limit_reached")).toEqual([]);
  });

  it("answers at 99 replies and ignores earlier months", async () => {
    const s = await seed({ autonomy: "auto" });
    await used(s, 99);
    await used(
      s,
      500,
      sql`(date_trunc('month', now() AT TIME ZONE 'utc') - interval '1 day')::date`,
    );
    const id = await guestSays(s, "¿A qué hora es la salida?");
    const { deps: d, llm } = deps();
    expect(await run(s, d, id)).toBe("answered");
    expect(methods(llm).length).toBeGreaterThan(0);
  });

  it("pools 300 replies per active property on Pro and applies custom limits", async () => {
    const pro = await seed({ autonomy: "auto" });
    await onPlan(pro, { plan: "pro" });
    await handle.db.insert(property).values({
      workspaceId: pro.workspaceId,
      name: "Casa Segunda",
      guideLanguages: ["es"],
      setupStatus: "ready",
      source: "manual",
    });
    await used(pro, 599);
    const first = await guestSays(pro, "¿A qué hora es la salida?");
    expect(await run(pro, deps().deps, first)).toBe("answered");
    // The answer above was reply 600 of 2 × 300.
    const second = await guestSays(pro, "¿Hay parqueo?");
    const { deps: d, llm } = deps();
    expect(await run(pro, d, second)).toBe("held");
    expect(methods(llm)).toEqual([]);

    const custom = await seed({ autonomy: "auto" });
    await onPlan(custom, { plan: "business", aiReplyMonthlyLimit: 5 });
    await used(custom, 5);
    const asked = await guestSays(custom, "¿A qué hora es la salida?");
    expect(await run(custom, deps().deps, asked)).toBe("held");
    expect((await stateOf(custom)).conv.reason).toBe("monthly_limit");
  });

  it("names the monthly limit when the daily budget is also reached", async () => {
    const s = await seed({ autonomy: "auto", propertyLimit: 1 });
    await onPlan(s, { aiReplyMonthlyLimit: 1 });
    await handle.db.insert(chatUsageDaily).values({
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      day: sql`(now() AT TIME ZONE 'utc')::date`,
      replies: 1,
    });
    const id = await guestSays(s, "¿A qué hora es la salida?");
    expect(await run(s, deps().deps, id)).toBe("held");
    expect((await stateOf(s)).conv.reason).toBe("monthly_limit");
  });
});

describe("copilot and assistant tests at the monthly limit (FR-007)", () => {
  it("ends both without a model call", async () => {
    const s = await seed({ autonomy: "auto" });
    await used(s, 100);
    const { deps: d, llm } = deps();

    const [run1] = await handle.db
      .insert(copilotRun)
      .values({
        workspaceId: s.workspaceId,
        propertyId: s.propertyId,
        createdBy: s.ownerId,
        message: "¿A qué hora es la salida?",
        bookingStatus: "confirmed",
      })
      .returning({ id: copilotRun.id });
    expect(await runCopilotDraft(d, { runId: run1!.id, workspaceId: s.workspaceId })).toBe(
      "monthly_limited",
    );

    const [test] = await handle.db
      .insert(assistantTest)
      .values({
        workspaceId: s.workspaceId,
        propertyId: s.propertyId,
        createdBy: s.ownerId,
        question: "¿A qué hora es la salida?",
        language: "es",
      })
      .returning({ id: assistantTest.id });
    expect(await runAssistantTest(d, { testId: test!.id, workspaceId: s.workspaceId })).toBe(
      "monthly_limited",
    );
    expect(methods(llm)).toEqual([]);
    const [stored] = await handle.db
      .select({ outcome: copilotRun.outcome })
      .from(copilotRun)
      .where(eq(copilotRun.id, run1!.id));
    expect(stored?.outcome).toBe("monthly_limited");
  });
});
