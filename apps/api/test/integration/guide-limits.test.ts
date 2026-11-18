import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery } from "./helpers.js";
import { seedTeam, wsApi, type Member, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/** GET /guide-limits (feature 003 FR-064, FR-065, T035). */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "guide-limits");
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

function limits(member: Member) {
  return wsApi(ctx, member, "GET", team.workspaceId, "/guide-limits");
}

describe("guide limits", () => {
  it("shows the pilot defaults to every member, agents included", async () => {
    for (const member of [team.owner, team.agent]) {
      const response = await limits(member);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({
        ai: { limit: 100, usedToday: 0 },
        media: { limitBytes: 2 * 1024 * 1024 * 1024, usedBytes: 0 },
      });
    }
  });

  it("uses the workspace's overrides and counts ready media", async () => {
    await db.query(
      `UPDATE workspace SET guide_ai_daily_limit = 7, media_storage_limit_mb = 10 WHERE id = $1`,
      [team.workspaceId],
    );
    await db.query(
      `INSERT INTO media_object (workspace_id, kind, status, object_prefix, bytes)
       VALUES ($1::uuid, 'image', 'ready', 'media/' || $1::text || '/' || gen_random_uuid() || '/', 5000),
              ($1::uuid, 'image', 'processing', 'media/' || $1::text || '/' || gen_random_uuid() || '/', 9000)`,
      [team.workspaceId],
    );
    const response = await limits(team.owner);
    expect(response.json()).toMatchObject({
      ai: { limit: 7 },
      media: { limitBytes: 10 * 1024 * 1024, usedBytes: 5000 },
    });
  });
});
