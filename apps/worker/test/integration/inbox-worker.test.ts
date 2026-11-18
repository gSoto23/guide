import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agentTrace,
  conversation,
  copilotRun,
  createDb,
  guideVersion,
  pushSubscription,
  type DbHandle,
} from "@guidesk/db";
import { FakePushAdapter } from "@guidesk/integrations";
import type { AnswerGuestInput } from "@guidesk/integrations";
import { runCopilotDraft } from "../../src/jobs/copilot-draft.js";
import { runNotificationPush } from "../../src/jobs/notification-push.js";
import { runQuietDigest } from "../../src/jobs/quiet-digest.js";
import {
  assistantMessages,
  deps,
  guestSays,
  methods,
  run,
  seed,
  setSettings,
  stateOf,
  useChatDb,
  type Seeded,
} from "./chat-helpers.js";

/**
 * Feature 006 in the worker (T015, T019, T026): take over in the reply job, the copilot job, push
 * jobs and their recipients, and push in the quiet hours summary. Fictional data only.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

async function takeOver(s: Seeded, userId: string | null) {
  await handle.db
    .update(conversation)
    .set({ takenOverBy: userId, takenOverAt: userId ? new Date() : null })
    .where(eq(conversation.id, s.conversationId));
}

describe("take over in the reply job (feature 006 US2)", () => {
  it("sends nothing, needs the team as taken over, and alerts only the member who took it", async () => {
    const s = await seed({ autonomy: "auto" });
    await takeOver(s, s.agentId);
    const { deps: d, llm, emails, pushes } = deps();
    expect(await run(s, d, await guestSays(s, "¿A qué hora es la salida?"))).toBe("held");
    expect(await assistantMessages(s)).toEqual([]);
    expect(methods(llm)).toEqual(["classifyGuestMessage"]);
    const { conv, drafts, traces } = await stateOf(s);
    expect(conv).toMatchObject({ status: "needs_host", reason: "taken_over" });
    expect(drafts).toEqual([]);
    expect(traces[0]).toMatchObject({ decision: "held", reason: "taken_over" });
    expect(emails.map((email) => email.to)).toEqual([s.agentEmail]);
    expect(pushes).toEqual([
      expect.objectContaining({ userId: s.agentId, kind: "needs_host", reason: "taken_over" }),
    ]);
  });

  it("still shows the emergency card and alerts the contacts and every owner", async () => {
    const s = await seed({ autonomy: "auto" });
    await takeOver(s, s.agentId);
    const { deps: d, emails } = deps();
    expect(await run(s, d, await guestSays(s, "Hay humo en la cocina"))).toBe("held");
    const messages = await assistantMessages(s);
    expect(messages.map((message) => message.kind)).toEqual(["emergency", "holding"]);
    expect((await stateOf(s)).conv.reason).toBe("emergency");
    expect(emails.map((email) => email.to).sort()).toEqual([s.agentEmail, s.ownerEmail].sort());
  });

  it("alerts the contacts when the member who took it over left, and answers again when handed back", async () => {
    const s = await seed({ autonomy: "auto" });
    await takeOver(s, null);
    await handle.db
      .update(conversation)
      .set({ takenOverAt: new Date() })
      .where(eq(conversation.id, s.conversationId));
    const { deps: d, emails } = deps();
    expect(await run(s, d, await guestSays(s, "¿A qué hora es la salida?"))).toBe("held");
    expect(emails.map((email) => email.to).sort()).toEqual([s.agentEmail, s.ownerEmail].sort());
    await handle.db
      .update(conversation)
      .set({ takenOverBy: null, takenOverAt: null, status: "open", needsHostReason: null })
      .where(eq(conversation.id, s.conversationId));
    expect(await run(s, d, await guestSays(s, "¿A qué hora es la salida?"))).toBe("answered");
  });
});

describe("push alerts (feature 006 US4)", () => {
  it("queues a push for each email recipient, and sends the summary by push", async () => {
    const s = await seed({ timeZone: "America/Costa_Rica" });
    await setSettings(s, "workspace", { quiet: { start: "22:00", end: "07:00" } });
    const night = deps({}, () => new Date("2026-11-19T05:10:00Z"));
    await run(s, night.deps, await guestSays(s, "¿A qué hora es la salida?"));
    expect(night.pushes).toEqual([]);
    const morning = deps();
    await runQuietDigest(
      {
        db: handle.db,
        queueEmail: morning.deps.queueEmail,
        queuePush: morning.deps.queuePush!,
        portalUrl: "http://localhost:3000",
      },
      new Date("2026-11-19T13:00:30Z"),
    );
    const mine = morning.pushes.filter((job) => job.propertyId === s.propertyId);
    expect(mine.map((job) => job.kind)).toEqual(["quiet_summary", "quiet_summary"]);
  });

  it("sends to every device with the property and reason only, and removes gone devices", async () => {
    const s = await seed();
    await handle.db.insert(pushSubscription).values([
      {
        userId: s.ownerId,
        endpoint: `https://push.example.test/${s.conversationId}/a`,
        p256dh: "k",
        auth: "a",
        device: "chrome-android",
      },
      {
        userId: s.ownerId,
        endpoint: `https://push.example.test/${s.conversationId}/b`,
        p256dh: "k",
        auth: "a",
        device: "safari-ios",
      },
    ]);
    const push = new FakePushAdapter(
      "BKey",
      new Set([`https://push.example.test/${s.conversationId}/b`]),
    );
    await guestSays(s, "Mi código secreto de prueba es TEST-0000 y mi teléfono también");
    const report = await runNotificationPush(
      { db: handle.db, push, portalUrl: "http://localhost:3000" },
      {
        userId: s.ownerId,
        kind: "needs_host",
        workspaceId: s.workspaceId,
        propertyId: s.propertyId,
        conversationId: s.conversationId,
        reason: "emergency",
      },
    );
    expect(report).toEqual({ sent: 1, gone: 1, failed: 0 });
    expect(push.sent[0]!.message).toEqual({
      title: "Casa Colibrí",
      body: "Posible emergencia",
      url: `http://localhost:3000/es/properties/${s.propertyId}/conversations/${s.conversationId}`,
      tag: `conversation-${s.conversationId}`,
      urgency: "high",
    });
    expect(JSON.stringify(push.sent)).not.toMatch(/TEST-0000|teléfono/);
    const left = await handle.db
      .select({ device: pushSubscription.device })
      .from(pushSubscription)
      .where(eq(pushSubscription.userId, s.ownerId));
    expect(left).toEqual([{ device: "chrome-android" }]);
    expect(
      await runNotificationPush(
        { db: handle.db, push: null, portalUrl: "http://localhost:3000" },
        { userId: s.ownerId, kind: "test" },
      ),
    ).toEqual({ sent: 0, gone: 0, failed: 0 });
  });
});

async function copilot(
  s: Seeded,
  message: string,
  bookingStatus: "inquiry" | "confirmed" = "confirmed",
) {
  const [row] = await handle.db
    .insert(copilotRun)
    .values({
      workspaceId: s.workspaceId,
      propertyId: s.propertyId,
      createdBy: s.ownerId,
      message,
      bookingStatus,
    })
    .returning({ id: copilotRun.id });
  return row!.id;
}

async function runOf(id: string) {
  const [row] = await handle.db.select().from(copilotRun).where(eq(copilotRun.id, id));
  return row!;
}

describe("copilot drafts (feature 006 US3)", () => {
  it("drafts a host-voice reply from the guide with checks, a trace, and usage, and no conversation", async () => {
    const s = await seed();
    const id = await copilot(s, "¿Se permiten fiestas en la casa?");
    const { deps: d, llm } = deps();
    expect(await runCopilotDraft(d, { runId: id, workspaceId: s.workspaceId })).toBe("drafted");
    const row = await runOf(id);
    expect(row).toMatchObject({
      status: "done",
      outcome: "drafted",
      covered: true,
      caution: null,
      sectionIds: [s.sections.house_rules],
      removed: [],
    });
    expect(row.draft).toContain("No se permiten fiestas");
    expect(row.checks.every((check) => check.passed)).toBe(true);
    const answer = llm.guideCalls.find((call) => call.method === "answerGuest")!
      .input as AnswerGuestInput;
    expect(answer).toMatchObject({ channel: "platform", bookingStatus: "confirmed" });
    const traces = await handle.db.select().from(agentTrace).where(eq(agentTrace.copilotRunId, id));
    expect(traces).toHaveLength(1);
    expect(await assistantMessages(s)).toEqual([]);
  });

  it("removes links and contact details for inquiries, with a note", async () => {
    const s = await seed();
    const id = await copilot(s, "¿Tienen página web?", "inquiry");
    const { deps: d } = deps({
      agentAnswer: () => ({
        answer: "Puedes ver más en https://casacolibri.example.com o escribir a ana@example.com.",
        kind: "general",
        sectionIds: [],
        answerable: true,
        needsHost: false,
      }),
    });
    await runCopilotDraft(d, { runId: id, workspaceId: s.workspaceId });
    const row = await runOf(id);
    expect(row.removed).toEqual(["link", "email"]);
    expect(row.draft).not.toMatch(/https|@/);
  });

  it("never gives the model a benefit recommendation", async () => {
    const s = await seed();
    const [version] = await handle.db
      .select({ snapshot: guideVersion.snapshot })
      .from(guideVersion)
      .where(eq(guideVersion.id, s.versionId));
    const snapshot = version!.snapshot as { sections: { kind: string; items: unknown[] }[] };
    snapshot.sections.push({
      kind: "local_recommendations",
      items: [
        {
          id: "rec-1",
          kind: "recommendation",
          sourceLanguage: "es",
          texts: {},
          recommendation: {
            name: "Tour Pagado",
            category: "tour",
            benefit: "commission",
            personalTip: false,
          },
        },
      ],
    } as never);
    await handle.db.update(guideVersion).set({ snapshot }).where(eq(guideVersion.id, s.versionId));
    const id = await copilot(s, "¿Qué tours recomiendan?");
    const { deps: d, llm } = deps();
    await runCopilotDraft(d, { runId: id, workspaceId: s.workspaceId });
    const answer = llm.guideCalls.find((call) => call.method === "answerGuest")!
      .input as AnswerGuestInput;
    expect(answer.knowledge).not.toContain("Tour Pagado");
  });

  it("answers code requests and emergencies with fixed texts and a caution, never a code", async () => {
    const s = await seed();
    const code = await copilot(s, "¿Cuál es el código de la caja de llaves?");
    const emergency = await copilot(s, "Hay humo en la cocina");
    const inquiry = await copilot(s, "¿Cuál es el código de la puerta?", "inquiry");
    const { deps: d, llm } = deps();
    for (const id of [code, emergency, inquiry]) {
      await runCopilotDraft(d, { runId: id, workspaceId: s.workspaceId });
    }
    expect(await runOf(code)).toMatchObject({ caution: "codes", sectionIds: [s.sections.arrival] });
    expect((await runOf(code)).draft).toContain("«Llegada y acceso»");
    expect((await runOf(emergency)).draft).toContain("llama ya al 911");
    expect((await runOf(emergency)).caution).toBe("emergency");
    expect((await runOf(inquiry)).draft).toBe(
      "Compartimos los detalles de acceso cuando la reserva está confirmada.",
    );
    expect(methods(llm).filter((method) => method === "answerGuest")).toEqual([]);
  });

  it("shows the caution for money and keeps a failing check visible", async () => {
    const s = await seed();
    const id = await copilot(s, "Quiero un reembolso");
    const { deps: d } = deps({
      agentAnswer: () => ({
        answer: "Claro, te hago un reembolso completo.",
        kind: "grounded",
        sectionIds: [s.sections.house_rules],
        answerable: true,
        needsHost: false,
      }),
    });
    await runCopilotDraft(d, { runId: id, workspaceId: s.workspaceId });
    const row = await runOf(id);
    expect(row.caution).toBe("money");
    expect(row.checks).toContainEqual({ check: "promises", passed: false });
  });

  it("makes no model call over the budget, and returns within 15 s with slow model calls", async () => {
    const limited = await seed({ propertyLimit: 0 });
    const id = await copilot(limited, "¿A qué hora es la salida?");
    const { deps: d, llm } = deps();
    expect(await runCopilotDraft(d, { runId: id, workspaceId: limited.workspaceId })).toBe(
      "limited",
    );
    expect(methods(llm)).toEqual([]);

    const s = await seed();
    const slow = await copilot(s, "¿A qué hora es la salida?");
    const timed = deps({ delayMs: 3_000 });
    const started = performance.now();
    expect(await runCopilotDraft(timed.deps, { runId: slow, workspaceId: s.workspaceId })).toBe(
      "drafted",
    );
    expect(performance.now() - started).toBeLessThan(15_000);
  }, 20_000);
});
