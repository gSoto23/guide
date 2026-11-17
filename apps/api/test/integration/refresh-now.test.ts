import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { PgBoss } from "pg-boss";
import { QUEUE_POLICIES } from "@guidesk/domain";
import { systemQuery } from "./helpers.js";
import {
  insertFeed,
  insertPmsConnection,
  insertProperty,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * "Refresh now" is applied within 1 minute (SC-006, T124). The schedulers spread refreshes over
 * up to 10 minutes, and the queues keep one waiting job per feed or connection, so a scheduled
 * refresh already waiting must be moved forward rather than leave "Refresh now" behind it.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let scheduler: PgBoss;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"), { PMS_BEDS24: "true" });
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "refresh-now");
  scheduler = new PgBoss(inject("databaseUrl"));
  await scheduler.start();
});

afterAll(async () => {
  await scheduler.stop({ graceful: false });
  await db.close();
  await ctx.app.close();
});

/** What the worker's scheduler queues: a refresh that waits up to 10 minutes. */
async function scheduleLater(queue: string, singletonKey: string, data: object) {
  const policy = QUEUE_POLICIES[queue];
  await scheduler.createQueue(queue, policy ? { policy } : undefined).catch(() => undefined);
  const id = await scheduler.send(queue, data, { singletonKey, startAfter: 600 });
  expect(id).not.toBeNull();
}

async function waiting(queue: string, singletonKey: string) {
  const { rows } = await db.query<{ starts_in: number; priority: number }>(
    `SELECT extract(epoch FROM start_after - now())::int AS starts_in, priority
       FROM pgboss.job WHERE name = $1 AND singleton_key = $2 AND state = 'created'`,
    [queue, singletonKey],
  );
  return rows;
}

describe("Refresh now within 1 minute (SC-006)", () => {
  it("moves a waiting scheduled feed refresh forward", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const feedId = await insertFeed(db, team.workspaceId, propertyId);
    await scheduleLater("calendar.refresh", `feed:${feedId}`, {
      feedId,
      workspaceId: team.workspaceId,
    });
    expect((await waiting("calendar.refresh", `feed:${feedId}`))[0]!.starts_in).toBeGreaterThan(
      500,
    );

    const response = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/properties/${propertyId}/calendar-feeds/refresh`,
    );
    expect(response.statusCode, response.body).toBe(202);
    const jobs = await waiting("calendar.refresh", `feed:${feedId}`);
    // Still one job, now due within seconds and ahead of scheduled refreshes.
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.starts_in).toBeLessThanOrEqual(5);
    expect(jobs[0]!.priority).toBe(10);
  });

  it("queues a feed refresh to start at once when none is waiting", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const feedId = await insertFeed(db, team.workspaceId, propertyId);
    await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/properties/${propertyId}/calendar-feeds/refresh`,
    );
    const jobs = await waiting("calendar.refresh", `feed:${feedId}`);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.starts_in).toBeLessThanOrEqual(5);
  });

  it("moves a waiting scheduled PMS refresh forward", async () => {
    const connectionId = await insertPmsConnection(db, team.workspaceId);
    await scheduleLater("pms.refresh", `pms:${connectionId}`, {
      connectionId,
      workspaceId: team.workspaceId,
    });
    const response = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/pms-connections/${connectionId}/refresh`,
    );
    expect(response.statusCode, response.body).toBe(202);
    const jobs = await waiting("pms.refresh", `pms:${connectionId}`);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.starts_in).toBeLessThanOrEqual(5);
    expect(jobs[0]!.priority).toBe(10);
  });
});
