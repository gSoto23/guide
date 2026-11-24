import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import { aiTopUp, chatUsageDaily, createDb, user, workspace, type DbHandle } from "@guidesk/db";
import type { EmailMessage } from "@guidesk/integrations";
import { runPlanUsageTick } from "../../src/jobs/plan-usage-tick.js";
import { seed, useChatDb, type Seeded } from "./chat-helpers.js";

/**
 * AI usage emails (feature 011 US1, T008): 80% and 100% once per threshold and month, to owners
 * only, in their language; nothing below 80%; again in a new month. Feature 019: the 100% email
 * mentions a top-up still answering, and a used-up top-up is emailed once. The job runs at fixed
 * moments in 2031, so other tests' usage never falls in its months; top-up emails are filtered by
 * recipient because other tests' top-ups share the database. Fictional data only.
 */
let handle: DbHandle;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 4 });
  useChatDb(handle);
});

afterAll(async () => {
  await handle.pool.end();
});

function tick(at: string) {
  const emails: EmailMessage[] = [];
  const topUpEmails: EmailMessage[] = [];
  return {
    emails,
    topUpEmails,
    run: () =>
      runPlanUsageTick({
        db: handle.db,
        queueEmail: async (message) => {
          (message.template === "plan.top_up_used_up" ? topUpEmails : emails).push(message);
        },
        portalUrl: "http://localhost:3000",
        now: () => new Date(at),
      }),
  };
}

async function used(s: Seeded, day: string, replies: number) {
  await handle.db
    .insert(chatUsageDaily)
    .values({ workspaceId: s.workspaceId, propertyId: s.propertyId, day, replies })
    .onConflictDoUpdate({
      target: [chatUsageDaily.propertyId, chatUsageDaily.day],
      set: { replies },
    });
}

describe("plan-usage.tick (FR-009)", () => {
  it("emails owners once at 80% and once at 100%, in their language", async () => {
    const s = await seed();
    await handle.db.update(user).set({ preferredLanguage: "en" }).where(eq(user.id, s.ownerId));
    await used(s, "2031-03-02", 399);
    const below = tick("2031-03-10T12:00:00Z");
    await below.run();
    expect(below.emails).toEqual([]);

    await used(s, "2031-03-02", 425);
    const warning = tick("2031-03-10T12:05:00Z");
    await warning.run();
    expect(warning.emails.map((email) => [email.to, email.template])).toEqual([
      [s.ownerEmail, "plan.ai_usage"],
    ]);
    expect(warning.emails[0]!.subject).toContain("80%");
    expect(warning.emails[0]!.text).toContain("425 of its 500");
    expect(warning.emails[0]!.text).toContain("April 1, 2031");
    expect(warning.emails[0]!.text).toContain("/en/settings/plan");

    const again = tick("2031-03-10T12:10:00Z");
    await again.run();
    expect(again.emails).toEqual([]);

    await used(s, "2031-03-02", 500);
    const full = tick("2031-03-10T12:15:00Z");
    await full.run();
    expect(full.emails).toHaveLength(1);
    expect(full.emails[0]!.subject).toContain("used up");
    const repeat = tick("2031-03-10T12:20:00Z");
    await repeat.run();
    expect(repeat.emails).toEqual([]);
  });

  it("sends only 100% when a workspace jumps past it, and starts again next month", async () => {
    const s = await seed();
    await handle.db
      .update(workspace)
      .set({ aiReplyMonthlyLimit: 10 })
      .where(eq(workspace.id, s.workspaceId));
    await used(s, "2031-05-03", 12);
    const jump = tick("2031-05-03T20:00:00Z");
    await jump.run();
    expect(jump.emails).toHaveLength(1);
    expect(jump.emails[0]!.subject).toContain("se acabaron");
    expect(jump.emails[0]!.to).toBe(s.ownerEmail);

    const later = tick("2031-05-20T20:00:00Z");
    await later.run();
    expect(later.emails).toEqual([]);

    await used(s, "2031-06-01", 9);
    const june = tick("2031-06-01T08:00:00Z");
    await june.run();
    expect(june.emails.map((email) => email.subject)).toEqual([expect.stringContaining("80%")]);
  });

  it("follows the plan's pooled allowance and never emails agents", async () => {
    const s = await seed();
    await handle.db.update(workspace).set({ plan: "pro" }).where(eq(workspace.id, s.workspaceId));
    // One property on Pro: 300 per property, at least 500 (feature 019).
    await used(s, "2031-08-04", 399);
    const below = tick("2031-08-04T10:00:00Z");
    await below.run();
    expect(below.emails).toEqual([]);
    await used(s, "2031-08-04", 400);
    const warning = tick("2031-08-04T10:05:00Z");
    await warning.run();
    expect(warning.emails.map((email) => email.to)).toEqual([s.ownerEmail]);
    expect(warning.emails.map((email) => email.to)).not.toContain(s.agentEmail);
  });

  it("says a top-up keeps the AI answering at 100% (feature 019 FR-013)", async () => {
    const s = await seed();
    await handle.db
      .update(workspace)
      .set({ aiReplyMonthlyLimit: 10 })
      .where(eq(workspace.id, s.workspaceId));
    await handle.db.insert(aiTopUp).values({
      workspaceId: s.workspaceId,
      repliesGranted: 50,
      repliesUsed: 2,
      note: "Prueba",
      expiresAt: new Date("2032-06-01T00:00:00Z"),
    });
    await used(s, "2031-09-02", 12);
    const full = tick("2031-09-02T12:00:00Z");
    await full.run();
    expect(full.emails).toHaveLength(1);
    expect(full.emails[0]!.text).toContain("La IA sigue respondiendo con tu recarga (quedan 48");
  });

  it("emails the owners once when a top-up is used up, never for corrected ones", async () => {
    const s = await seed();
    const [usedUp] = await handle.db
      .insert(aiTopUp)
      .values({
        workspaceId: s.workspaceId,
        repliesGranted: 3,
        repliesUsed: 3,
        note: "Prueba",
        expiresAt: new Date("2032-06-01T00:00:00Z"),
      })
      .returning({ id: aiTopUp.id });
    await handle.db.insert(aiTopUp).values({
      workspaceId: s.workspaceId,
      repliesGranted: 4,
      repliesUsed: 4,
      note: "Corregida",
      correctedAt: new Date(),
      correctionNote: "Sobraba",
      expiresAt: new Date("2032-06-01T00:00:00Z"),
    });
    const first = tick("2031-10-05T12:00:00Z");
    const report = await first.run();
    const mine = first.topUpEmails.filter((email) => email.to === s.ownerEmail);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.text).toContain("Se usaron las 3 respuestas de IA de tu recarga.");
    expect(first.topUpEmails.map((email) => email.to)).not.toContain(s.agentEmail);
    expect(report.topUpsNotified).toBeGreaterThanOrEqual(1);
    const [row] = await handle.db
      .select({ at: aiTopUp.exhaustedNotifiedAt })
      .from(aiTopUp)
      .where(eq(aiTopUp.id, usedUp!.id));
    expect(row?.at).not.toBeNull();

    const again = tick("2031-10-05T12:05:00Z");
    await again.run();
    expect(again.topUpEmails.filter((email) => email.to === s.ownerEmail)).toEqual([]);
  });
});
