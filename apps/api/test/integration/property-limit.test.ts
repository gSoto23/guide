import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { property, withRlsContext, type DbHandle } from "@guidesk/db";
import { ApiProblem } from "../../src/common/problem.js";
import { REQUEST_DB_HANDLE } from "../../src/database/database.module.js";
import { PropertyLimitService } from "../../src/properties/property-limit.service.js";
import { systemQuery } from "./helpers.js";
import { newOwner } from "./invitation-helpers.js";
import { createTestApp } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let limits: PropertyLimitService;
let requestDb: DbHandle;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  limits = ctx.app.get(PropertyLimitService);
  requestDb = ctx.app.get<DbHandle>(REQUEST_DB_HANDLE);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

/** A signed-up owner, with the user ID the request context needs. */
async function owner(prefix: string) {
  const created = await newOwner(ctx, prefix);
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM membership WHERE workspace_id = $1 AND role = 'owner'`,
    [created.workspaceId],
  );
  return { ...created, userId: rows[0]!.user_id };
}

async function insertProperty(workspaceId: string, status: "active" | "removed" = "active") {
  await db.query(
    `INSERT INTO property (workspace_id, name, guide_languages, setup_status, source, status, removed_at, purge_after)
     VALUES ($1, $2, '{es}', 'needs_details', 'manual', $3,
       CASE WHEN $3 = 'removed' THEN now() END, CASE WHEN $3 = 'removed' THEN now() + interval '30 days' END)`,
    [workspaceId, `Casa ${randomUUID().slice(0, 8)}`, status],
  );
}

/** Takes one slot and inserts a property in the owner's request context, as POST /properties does. */
function createOne(userId: string, workspaceId: string) {
  return withRlsContext(requestDb.db, { userId, workspaceId }, async (tx) => {
    await limits.withCreationSlot(tx, workspaceId, 1);
    // Give the other transaction time to reach the lock while this one holds it.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await tx.insert(property).values({
      workspaceId,
      name: "Casa paralela",
      guideLanguages: ["es"],
      setupStatus: "needs_details",
      source: "manual",
    });
  });
}

describe("property limit (T024, FR-047, R12)", () => {
  it("creates exactly one property when two creations race for the last slot", async () => {
    const ana = await owner("limit-race");
    await db.query(`UPDATE workspace SET property_limit = 2 WHERE id = $1`, [ana.workspaceId]);
    await insertProperty(ana.workspaceId);

    const results = await Promise.allSettled([
      createOne(ana.userId, ana.workspaceId),
      createOne(ana.userId, ana.workspaceId),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(ApiProblem);
    expect((refused.reason as ApiProblem).code).toBe("plan_limit_reached");
    expect((refused.reason as ApiProblem).extra.details).toEqual({ limit: 2, used: 2 });
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM property WHERE workspace_id = $1 AND status = 'active'`,
      [ana.workspaceId],
    );
    expect(rows[0]?.count).toBe(2);
  });

  it("uses the Free plan's 2 when no pilot limit is set, and ignores removed properties", async () => {
    const ana = await owner("limit-default");
    await insertProperty(ana.workspaceId);
    await insertProperty(ana.workspaceId, "removed");
    const slots = await withRlsContext(
      requestDb.db,
      { userId: ana.userId, workspaceId: ana.workspaceId },
      (tx) => limits.withCreationSlot(tx, ana.workspaceId, 1),
    );
    expect(slots).toEqual({ limit: 2, used: 1, free: 1 });
  });

  it("caps an import at the free slots, and refuses when none are left", async () => {
    const ana = await owner("limit-capped");
    await db.query(`UPDATE workspace SET property_limit = 3 WHERE id = $1`, [ana.workspaceId]);
    await insertProperty(ana.workspaceId);
    const run = (count: number, capped: boolean) =>
      withRlsContext(requestDb.db, { userId: ana.userId, workspaceId: ana.workspaceId }, (tx) =>
        limits.withCreationSlot(tx, ana.workspaceId, count, { capped }),
      );
    await expect(run(5, true)).resolves.toEqual({ limit: 3, used: 1, free: 2 });
    await expect(run(5, false)).rejects.toMatchObject({ code: "plan_limit_reached" });
    await insertProperty(ana.workspaceId);
    await insertProperty(ana.workspaceId);
    await expect(run(5, true)).rejects.toMatchObject({ code: "plan_limit_reached" });
  });

  it("refuses creation in a workspace pending deletion (FR-049)", async () => {
    const ana = await owner("limit-pending");
    await db.query(
      `UPDATE workspace SET status = 'pending_deletion', deleted_at = now(), purge_after = now() + interval '30 days' WHERE id = $1`,
      [ana.workspaceId],
    );
    await expect(
      withRlsContext(requestDb.db, { userId: ana.userId, workspaceId: ana.workspaceId }, (tx) =>
        limits.withCreationSlot(tx, ana.workspaceId, 1),
      ),
    ).rejects.toMatchObject({ code: "workspace_pending_deletion" });
  });
});
