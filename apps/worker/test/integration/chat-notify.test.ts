import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import { chatHeldNotice, conversation, createDb, membership, type DbHandle } from "@guidesk/db";
import type { EmailMessage } from "@guidesk/integrations";
import { runQuietDigest } from "../../src/jobs/quiet-digest.js";
import {
  assistantMessages,
  deps,
  guestSays,
  run,
  seed,
  setSettings,
  useChatDb,
} from "./chat-helpers.js";

/**
 * Escalation contacts and quiet hours (feature 007 US3, T024): who gets "needs the host" emails,
 * held notices during quiet hours in the property's time zone, urgent reasons at any hour, the
 * holding reply's quiet hours line, and the summary when the window ends. Fictional data only.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

/** 23:10 in Costa Rica (UTC-6); quiet hours 22:00 to 07:00 end at 13:00 UTC. */
const lateNight = () => new Date("2026-11-19T05:10:00Z");
const afterWindow = new Date("2026-11-19T13:00:30Z");
const quiet = { start: "22:00", end: "07:00" };
const to = (emails: EmailMessage[]) => emails.map((email) => email.to).sort();

describe("escalation contacts (feature 007 FR-010)", () => {
  it("emails only the chosen contacts", async () => {
    const s = await seed();
    await setSettings(s, "workspace", { contacts: [s.agentMembershipId] });
    const { deps: d, emails } = deps();
    expect(await run(s, d, await guestSays(s, "¿A qué hora es la salida?"))).toBe("drafted");
    expect(to(emails)).toEqual([s.agentEmail]);
  });

  it("adds every owner and admin for emergencies", async () => {
    const s = await seed();
    await setSettings(s, "workspace", { contacts: [s.agentMembershipId] });
    const { deps: d, emails } = deps();
    expect(await run(s, d, await guestSays(s, "Hay humo en la cocina"))).toBe("held");
    expect(to(emails)).toEqual([s.agentEmail, s.ownerEmail].sort());
  });

  it("falls back to every member who handles conversations when no contact is left", async () => {
    const s = await seed();
    await setSettings(s, "workspace", { contacts: [s.agentMembershipId] });
    await handle.db.delete(membership).where(eq(membership.id, s.agentMembershipId));
    const { deps: d, emails } = deps();
    expect(await run(s, d, await guestSays(s, "¿A qué hora es la salida?"))).toBe("drafted");
    expect(to(emails)).toEqual([s.ownerEmail]);
  });

  it("follows a property's own contacts", async () => {
    const s = await seed();
    await setSettings(s, "workspace", { contacts: [s.agentMembershipId] });
    await setSettings(s, "property", { contacts: [s.ownerMembershipId], ownGroups: ["contacts"] });
    const { deps: d, emails } = deps();
    await run(s, d, await guestSays(s, "¿A qué hora es la salida?"));
    expect(to(emails)).toEqual([s.ownerEmail]);
  });
});

describe("quiet hours (feature 007 FR-008, FR-009)", () => {
  it("holds non-urgent emails and says when the host usually answers", async () => {
    const s = await seed({ timeZone: "America/Costa_Rica" });
    await setSettings(s, "workspace", { quiet });
    const { deps: d, emails } = deps({}, lateNight);
    expect(await run(s, d, await guestSays(s, "¿A qué hora es la salida?"))).toBe("drafted");
    expect(emails).toEqual([]);
    const [holding] = await assistantMessages(s);
    expect(holding!.body).toContain("Tu anfitrión suele responder después de las 07:00.");
    expect(holding!.body).toContain("plataforma de tu reserva");
    const notices = await handle.db
      .select()
      .from(chatHeldNotice)
      .where(eq(chatHeldNotice.conversationId, s.conversationId));
    expect(notices).toHaveLength(2);
    expect(
      notices.every((notice) => notice.releaseAt.toISOString() === "2026-11-19T13:00:00.000Z"),
    ).toBe(true);
  });

  it("emails emergencies and malfunctions at once", async () => {
    for (const message of ["Hay humo en la cocina", "El aire acondicionado no funciona"]) {
      const s = await seed({ timeZone: "America/Costa_Rica" });
      await setSettings(s, "workspace", { quiet, contacts: [s.agentMembershipId] });
      const { deps: d, emails } = deps({}, lateNight);
      expect(await run(s, d, await guestSays(s, message))).toBe("held");
      expect(emails.length).toBeGreaterThan(0);
      const holding = (await assistantMessages(s)).find((m) => m.kind === "holding");
      if (message.includes("humo")) expect(holding!.body).not.toContain("suele responder");
    }
  });

  it("does nothing outside the window or without a time zone", async () => {
    const noZone = await seed();
    await setSettings(noZone, "workspace", { quiet });
    const { deps: d, emails } = deps({}, lateNight);
    await run(noZone, d, await guestSays(noZone, "¿A qué hora es la salida?"));
    expect(emails).toHaveLength(2);

    const daytime = await seed({ timeZone: "America/Costa_Rica" });
    await setSettings(daytime, "workspace", { quiet });
    const day = deps({}, () => new Date("2026-11-19T18:00:00Z"));
    await run(daytime, day.deps, await guestSays(daytime, "¿A qué hora es la salida?"));
    expect(day.emails).toHaveLength(2);
  });

  it("sends one summary per recipient when the window ends, skipping answered conversations", async () => {
    const waiting = await seed({ timeZone: "America/Costa_Rica" });
    await setSettings(waiting, "workspace", { quiet, contacts: [waiting.ownerMembershipId] });
    const answered = await seed({ timeZone: "America/Costa_Rica" });
    await setSettings(answered, "workspace", { quiet });
    const night = deps({}, lateNight);
    await run(waiting, night.deps, await guestSays(waiting, "¿Dónde puedo parquear el carro?"));
    await run(answered, night.deps, await guestSays(answered, "¿A qué hora es la salida?"));
    expect(night.emails).toEqual([]);
    // A member answers the second conversation before the window ends.
    await handle.db
      .update(conversation)
      .set({ status: "open", needsHostReason: null })
      .where(eq(conversation.id, answered.conversationId));

    const morning = deps();
    const early = await runQuietDigest(morning.deps, new Date("2026-11-19T12:59:00Z"));
    expect(early.emails).toBe(0);
    const report = await runQuietDigest(morning.deps, afterWindow);
    const mine = morning.emails.filter((email) =>
      [waiting.ownerEmail, answered.ownerEmail, answered.agentEmail].includes(email.to),
    );
    expect(mine.map((email) => email.to)).toEqual([waiting.ownerEmail]);
    expect(mine[0]!.subject).toContain("Casa Colibrí");
    expect(mine[0]!.text).toContain("parquear");
    expect(mine[0]!.text).toContain(`/conversations/${waiting.conversationId}`);
    expect(report.notices).toBeGreaterThanOrEqual(3);
    const left = await handle.db
      .select()
      .from(chatHeldNotice)
      .where(eq(chatHeldNotice.conversationId, waiting.conversationId));
    expect(left).toEqual([]);
    // Nothing is sent twice.
    const again = deps();
    await runQuietDigest(again.deps, afterWindow);
    expect(again.emails.filter((email) => email.to === waiting.ownerEmail)).toEqual([]);
  });
});
