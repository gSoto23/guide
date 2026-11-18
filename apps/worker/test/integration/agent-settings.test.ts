import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb, type DbHandle } from "@guidesk/db";
import type { AnswerGuestInput } from "@guidesk/integrations";
import {
  assistantMessages,
  deps,
  guestSays,
  methods,
  run,
  seed,
  setSettings,
  stateOf,
  uniformAutonomy,
  useChatDb,
} from "./chat-helpers.js";

/**
 * The reply job under feature 007 settings (T014, T020, T031): the topic's level and its source,
 * a property's own levels, mandatory escalations at every level, clarifying questions and general
 * answers at `full_auto`, tone in every fixed text, and the host's preferences only in the answer
 * call's cached prefix. Fictional data only.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

const answerInput = (calls: { method: string; input: unknown }[]) =>
  calls.find((call) => call.method === "answerGuest")?.input as AnswerGuestInput | undefined;

describe("autonomy per topic (feature 007 US1)", () => {
  it("applies each topic's level and records it with its source", async () => {
    const s = await seed();
    await setSettings(s, "workspace", {
      autonomy: { ...uniformAutonomy("draft"), checkout: "auto" },
    });
    const { deps: d } = deps();
    expect(await run(s, d, await guestSays(s, "¿A qué hora es la salida?"))).toBe("answered");
    expect(await run(s, d, await guestSays(s, "¿Se permiten fiestas en la casa?"))).toBe("drafted");
    const { traces, drafts, conv } = await stateOf(s);
    expect(traces.map((trace) => [trace.autonomy, trace.autonomySource, trace.reason])).toEqual([
      ["auto", "workspace", null],
      ["draft", "workspace", "draft_ready"],
    ]);
    expect(drafts).toHaveLength(1);
    expect(conv).toMatchObject({ status: "needs_host", reason: "draft_ready" });
  });

  it("uses a property's own levels, and the workspace's again when it follows", async () => {
    const s = await seed({ autonomy: "auto" });
    await setSettings(s, "property", {
      autonomy: uniformAutonomy("draft"),
      ownGroups: ["autonomy"],
    });
    const { deps: d } = deps();
    expect(await run(s, d, await guestSays(s, "¿A qué hora es la salida?"))).toBe("drafted");
    await setSettings(s, "property", { ownGroups: [] });
    expect(await run(s, d, await guestSays(s, "¿A qué hora es la salida?"))).toBe("answered");
    const { traces } = await stateOf(s);
    expect(traces.map((trace) => [trace.autonomy, trace.autonomySource])).toEqual([
      ["draft", "property"],
      ["auto", "workspace"],
    ]);
  });

  it("never answers a mandatory escalation, even at full_auto", async () => {
    const s = await seed({ autonomy: "full_auto" });
    const { deps: d, llm } = deps();
    for (const message of [
      "Hay humo en la cocina",
      "Quiero un reembolso",
      "¿Podemos extender una noche extra?",
      "El aire acondicionado no funciona",
    ]) {
      expect(await run(s, d, await guestSays(s, message))).toBe("held");
    }
    expect(methods(llm).filter((method) => method === "answerGuest")).toEqual([]);
    const { traces } = await stateOf(s);
    expect(traces.map((trace) => trace.reason)).toEqual([
      "emergency",
      "money",
      "reservation_change",
      "malfunction",
    ]);
    expect(traces.every((trace) => trace.autonomy === "full_auto")).toBe(true);
  });
});

describe("clarifying questions and general answers (feature 007 US2)", () => {
  it("sends one clarifying question at full_auto, never two in a row", async () => {
    const s = await seed();
    await setSettings(s, "workspace", { autonomy: uniformAutonomy("full_auto") });
    const { deps: d } = deps();
    expect(await run(s, d, await guestSays(s, "Is it far?"))).toBe("answered");
    expect(await run(s, d, await guestSays(s, "Is it far?"))).toBe("drafted");
    const [first] = await assistantMessages(s);
    expect(first!.body).toContain("Far from where");
    expect(first!.payload).toEqual({ sections: [] });
    const { traces } = await stateOf(s);
    expect(traces.map((trace) => [trace.answerKind, trace.decision, trace.reason])).toEqual([
      ["clarify", "answered", null],
      ["clarify", "drafted", "draft_ready"],
    ]);
    expect(traces[0]!.checks.map((check) => check.check)).toEqual([
      "codes",
      "links",
      "promises",
      "off_platform",
      "clarify",
    ]);
  });

  it("sends a general answer at full_auto and drafts it at auto", async () => {
    const full = await seed({ autonomy: "full_auto" });
    const { deps: d } = deps();
    expect(await run(full, d, await guestSays(full, "What's the weather like in March?"))).toBe(
      "answered",
    );
    const { traces } = await stateOf(full);
    expect(traces[0]).toMatchObject({ answerKind: "general", sectionIds: [] });
    expect(traces[0]!.checks).toContainEqual({ check: "price", passed: true });

    const auto = await seed({ autonomy: "auto" });
    expect(await run(auto, d, await guestSays(auto, "What's the weather like in March?"))).toBe(
      "drafted",
    );
    expect((await stateOf(auto)).traces[0]).toMatchObject({
      answerKind: "general",
      reason: "draft_ready",
    });
  });

  it("drafts a general answer that states a price, naming the check", async () => {
    const s = await seed({ autonomy: "full_auto" });
    const { deps: d } = deps({
      agentAnswer: () => ({
        answer: "A taxi to the airport costs about $40.",
        kind: "general",
        sectionIds: [],
        answerable: true,
        needsHost: false,
      }),
    });
    expect(await run(s, d, await guestSays(s, "How much is a taxi to the airport?"))).toBe(
      "drafted",
    );
    const { traces, conv } = await stateOf(s);
    expect(conv.reason).toBe("check_failed");
    expect(traces[0]!.checks).toContainEqual({ check: "price", passed: false });
  });
});

describe("tone and the host's preferences (feature 007 US4)", () => {
  it("writes every fixed text in the formal tone", async () => {
    const s = await seed();
    await setSettings(s, "workspace", { tone: "formal" });
    const { deps: d } = deps();
    await run(s, d, await guestSays(s, "hola"));
    await run(s, d, await guestSays(s, "¿A qué hora es la salida?"));
    await run(s, d, await guestSays(s, "Hay humo en la cocina"));
    const bodies = (await assistantMessages(s)).map((message) => message.body);
    expect(bodies[0]).toContain("Pregúnteme");
    expect(bodies[1]).toContain("Su anfitrión lo revisará y le responderá");
    expect(bodies[2]).toContain("llame ya");
    for (const body of bodies) expect(body).not.toMatch(/[¡!]|\btu\b|puedes/);
    const { traces } = await stateOf(s);
    expect(traces.every((trace) => trace.tone === "formal")).toBe(true);
  });

  it("gives the tone and both scopes' preferences to the answer call only, and records their versions", async () => {
    const s = await seed({ autonomy: "auto" });
    const workspace = await setSettings(s, "workspace", {
      tone: "formal",
      instructions: "Firma como el equipo de Casa Colibrí.",
    });
    const own = await setSettings(s, "property", {
      instructions: "Sugiere caminar a la playa.",
    });
    const { deps: d, llm } = deps();
    expect(await run(s, d, await guestSays(s, "¿A qué hora es la salida?"))).toBe("answered");
    const input = answerInput(llm.guideCalls);
    expect(input?.tone).toBe("formal");
    expect(input?.preferences).toEqual({
      workspace: "Firma como el equipo de Casa Colibrí.",
      property: "Sugiere caminar a la playa.",
    });
    const classify = llm.guideCalls.find((call) => call.method === "classifyGuestMessage");
    expect(JSON.stringify(classify?.input)).not.toMatch(/Firma|playa|formal/);
    const { traces } = await stateOf(s);
    expect(traces[0]).toMatchObject({
      workspaceInstructionVersionId: workspace.instructionVersionId,
      propertyInstructionVersionId: own.instructionVersionId,
    });
  });

  it("records no instructions when the answer call never ran", async () => {
    const s = await seed({ autonomy: "auto" });
    await setSettings(s, "workspace", { instructions: "Responde siempre los reembolsos." });
    const { deps: d } = deps();
    expect(await run(s, d, await guestSays(s, "Quiero un reembolso"))).toBe("held");
    const { traces } = await stateOf(s);
    expect(traces[0]).toMatchObject({
      reason: "money",
      workspaceInstructionVersionId: null,
      propertyInstructionVersionId: null,
    });
  });
});
