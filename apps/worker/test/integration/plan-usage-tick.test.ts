import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import { chatUsageDaily, createDb, user, workspace, type DbHandle } from "@guidesk/db";
import type { EmailMessage } from "@guidesk/integrations";
import { runPlanUsageTick } from "../../src/jobs/plan-usage-tick.js";
import { seed, useChatDb, type Seeded } from "./chat-helpers.js";

/**
 * AI usage emails (feature 011 US1, T008): 80% and 100% once per threshold and month, to owners
 * only, in their language; nothing below 80%; again in a new month. The job runs at fixed moments
 * in 2031, so other tests' usage never falls in its months. Fictional data only.
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
  return {
    emails,
    run: () =>
      runPlanUsageTick({
        db: handle.db,
        queueEmail: async (message) => {
          emails.push(message);
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
    await used(s, "2031-03-02", 79);
    const below = tick("2031-03-10T12:00:00Z");
    await below.run();
    expect(below.emails).toEqual([]);

    await used(s, "2031-03-02", 85);
    const warning = tick("2031-03-10T12:05:00Z");
    await warning.run();
    expect(warning.emails.map((email) => [email.to, email.template])).toEqual([
      [s.ownerEmail, "plan.ai_usage"],
    ]);
    expect(warning.emails[0]!.subject).toContain("80%");
    expect(warning.emails[0]!.text).toContain("85 of its 100");
    expect(warning.emails[0]!.text).toContain("April 1, 2031");
    expect(warning.emails[0]!.text).toContain("/en/settings/plan");

    const again = tick("2031-03-10T12:10:00Z");
    await again.run();
    expect(again.emails).toEqual([]);

    await used(s, "2031-03-02", 100);
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
    await used(s, "2031-08-04", 239);
    const below = tick("2031-08-04T10:00:00Z");
    await below.run();
    expect(below.emails).toEqual([]);
    await used(s, "2031-08-04", 240);
    const warning = tick("2031-08-04T10:05:00Z");
    await warning.run();
    expect(warning.emails.map((email) => email.to)).toEqual([s.ownerEmail]);
    expect(warning.emails.map((email) => email.to)).not.toContain(s.agentEmail);
  });
});
