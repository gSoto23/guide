import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb, type DbHandle } from "@guidesk/db";
import { assistantMessages, deps, guestSays, run, seed, useChatDb } from "./chat-helpers.js";

/**
 * Reply timings (feature 005 T048, plan Performance Budget) with the fake model plus simulated
 * latency: a full answer (two calls of 3 s each) within 10 s, and the emergency card (the
 * classification alone) within 2 s of a 1.5 s classification. The real model is a staging gate.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

describe("chat.reply timings (feature 005 plan)", () => {
  it("answers within 10 s when each model call takes 3 s", async () => {
    const s = await seed({ autonomy: "auto" });
    const id = await guestSays(s, "¿A qué hora es la salida?");
    const { deps: d } = deps({ delayMs: 3_000 });
    const started = performance.now();
    expect(await run(s, d, id)).toBe("answered");
    expect(performance.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it("shows the emergency card within 2 s when classification takes 1.5 s", async () => {
    const s = await seed({ autonomy: "auto" });
    const id = await guestSays(s, "Hay humo en la cocina");
    const { deps: d } = deps({ delayMs: 1_500 });
    const started = performance.now();
    expect(await run(s, d, id)).toBe("held");
    expect(performance.now() - started).toBeLessThan(2_000);
    expect((await assistantMessages(s))[0]!.kind).toBe("emergency");
  }, 10_000);

  it("gives up at the deadline and sends a holding reply (FR-029)", async () => {
    const s = await seed({ autonomy: "auto" });
    const id = await guestSays(s, "¿A qué hora es la salida?");
    const { deps: d } = deps({ delayMs: 2_000 });
    d.classifyTimeoutMs = 500;
    const started = performance.now();
    expect(await run(s, d, id)).toBe("held");
    expect(performance.now() - started).toBeLessThan(1_500);
    expect((await assistantMessages(s))[0]!.body).toContain("no está disponible");
  }, 10_000);
});
