import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agentTrace,
  assistantTest,
  chatMessage,
  chatUsageDaily,
  conversation,
  createDb,
  guide,
  type DbHandle,
} from "@guidesk/db";
import { runAssistantTest } from "../../src/jobs/assistant-test.js";
import { deps, methods, seed, setSettings, useChatDb, type Seeded } from "./chat-helpers.js";

/**
 * "Test the assistant" (feature 007 US5, T037): every outcome under the saved settings, no
 * conversation, message, draft, or email, a trace marked with the test, the usage counted, and the
 * 15-second budget with simulated model latency. Fictional data only.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

async function ask(s: Seeded, question: string, language: "es" | "en" = "es") {
  const [row] = await handle.db
    .insert(assistantTest)
    .values({
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      createdBy: s.ownerId,
      question,
      language,
    })
    .returning({ id: assistantTest.id });
  return row!.id;
}

async function result(id: string) {
  const [row] = await handle.db.select().from(assistantTest).where(eq(assistantTest.id, id));
  return row!;
}

describe("assistant.test (feature 007 US5)", () => {
  it("predicts a sent answer and writes only the test, its trace, and the usage", async () => {
    const s = await seed({ autonomy: "auto" });
    const id = await ask(s, "¿A qué hora es la salida?");
    const { deps: d, emails } = deps();
    expect(await runAssistantTest(d, { testId: id, workspaceId: s.workspaceId })).toBe("sent");
    expect(await result(id)).toMatchObject({
      status: "done",
      outcome: "sent",
      topic: "checkout",
      answerKind: "grounded",
      sectionIds: [s.sections.checkout],
    });
    expect((await result(id)).reply).toContain("11:00");
    const traces = await handle.db
      .select()
      .from(agentTrace)
      .where(eq(agentTrace.assistantTestId, id));
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      conversationId: null,
      decision: "answered",
      autonomy: "auto",
    });
    const messages = await handle.db
      .select()
      .from(chatMessage)
      .where(eq(chatMessage.conversationId, s.conversationId));
    expect(messages).toEqual([]);
    const [conv] = await handle.db
      .select({ status: conversation.status })
      .from(conversation)
      .where(eq(conversation.id, s.conversationId));
    expect(conv!.status).toBe("open");
    expect(emails).toEqual([]);
    const [usage] = await handle.db
      .select({ replies: chatUsageDaily.replies })
      .from(chatUsageDaily)
      .where(eq(chatUsageDaily.propertyId, s.propertyId));
    expect(usage?.replies).toBe(1);
  });

  it("predicts drafts, holds, pointers, and greetings", async () => {
    const s = await seed();
    await setSettings(s, "workspace", { tone: "formal" });
    const { deps: d, emails } = deps();
    const cases: [string, string, Record<string, unknown>][] = [
      ["¿A qué hora es la salida?", "draft", { reason: "draft_ready" }],
      ["Hay humo en la cocina", "held", { reason: "emergency" }],
      ["¿Cuál es el código de la puerta?", "pointer", { reason: null }],
      ["hola", "greeting", { reason: null }],
    ];
    for (const [question, outcome, extra] of cases) {
      const id = await ask(s, question);
      expect(await runAssistantTest(d, { testId: id, workspaceId: s.workspaceId })).toBe(outcome);
      expect(await result(id)).toMatchObject({ outcome, ...extra });
    }
    const emergency = await handle.db
      .select({ reply: assistantTest.reply })
      .from(assistantTest)
      .where(eq(assistantTest.question, "Hay humo en la cocina"));
    expect(emergency.at(-1)!.reply).toContain("llame ya");
    expect(emails).toEqual([]);
  });

  it("makes no model call over the budget, and reports an unpublished guide", async () => {
    const limited = await seed({ autonomy: "auto", propertyLimit: 0 });
    const { deps: d, llm } = deps();
    const id = await ask(limited, "¿A qué hora es la salida?");
    expect(await runAssistantTest(d, { testId: id, workspaceId: limited.workspaceId })).toBe(
      "limited",
    );
    expect(methods(llm)).toEqual([]);

    const closed = await seed({ autonomy: "auto" });
    await handle.db
      .update(guide)
      .set({ status: "draft" })
      .where(eq(guide.propertyId, closed.propertyId));
    const other = await ask(closed, "¿A qué hora es la salida?");
    expect(await runAssistantTest(d, { testId: other, workspaceId: closed.workspaceId })).toBe(
      "unavailable",
    );
    // Another workspace's test is never run.
    const foreign = await ask(limited, "hola");
    expect(await runAssistantTest(d, { testId: foreign, workspaceId: closed.workspaceId })).toBe(
      "skipped",
    );
  });

  it("returns within 15 s when each model call takes 3 s", async () => {
    const s = await seed({ autonomy: "auto" });
    const id = await ask(s, "¿A qué hora es la salida?");
    const { deps: d } = deps({ delayMs: 3_000 });
    const started = performance.now();
    expect(await runAssistantTest(d, { testId: id, workspaceId: s.workspaceId })).toBe("sent");
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 20_000);
});
