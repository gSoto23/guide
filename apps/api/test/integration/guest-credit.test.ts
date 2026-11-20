import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuestGuide } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { guest, publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The "Made with Guidesk" credit (feature 015 T025, FR-022): only guides of Free-plan workspaces
 * carry it, and it follows the current plan. All values are fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "guestcredit");
  published = await publishedGuide(ctx, team);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

async function credit(): Promise<boolean> {
  const response = await guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}?lang=es`);
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as GuestGuide).credit;
}

describe("guide credit by plan", () => {
  it("is shown for a Free workspace", async () => {
    await db.query(`UPDATE workspace SET plan = 'free' WHERE id = $1`, [team.workspaceId]);
    expect(await credit()).toBe(true);
  });

  it.each(["pro", "business"])("is hidden for a %s workspace", async (plan) => {
    await db.query(`UPDATE workspace SET plan = $2 WHERE id = $1`, [team.workspaceId, plan]);
    expect(await credit()).toBe(false);
  });
});
