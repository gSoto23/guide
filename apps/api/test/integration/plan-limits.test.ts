import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { property, withRlsContext, type DbHandle } from "@guidesk/db";
import { REQUEST_DB_HANDLE } from "../../src/database/database.module.js";
import { PropertyLimitService } from "../../src/properties/property-limit.service.js";
import { signIn, systemQuery, uniqueEmail } from "./helpers.js";
import { api, invitationsUrl, invitationTokenFor, newOwner } from "./invitation-helpers.js";
import { READY_FACTS } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Properties and seats follow the plan (feature 011 US2, T011): Free refuses a third property and
 * any invitation with `{limit, used}`; Pro and Business allow them up to their limits; removed
 * properties don't count; racing requests never pass the limit; pending invitations survive a
 * downgrade; a workspace above a limit keeps everything. Synthetic data only.
 */
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

/** A new owner on `plan` with no custom limits (the helper's team seats removed). */
async function ownerOn(prefix: string, plan: "free" | "pro" | "business" = "free") {
  const created = await newOwner(ctx, prefix);
  await db.query(
    `UPDATE workspace SET plan = $2, seat_limit = NULL, property_limit = NULL WHERE id = $1`,
    [created.workspaceId, plan],
  );
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

const invite = (owner: { cookie: string; workspaceId: string }, email = uniqueEmail("plan-inv")) =>
  api(ctx, "POST", invitationsUrl(owner.workspaceId), owner.cookie, { email, role: "agent" });

const slot = (owner: { userId: string; workspaceId: string }, count = 1, capped = false) =>
  withRlsContext(requestDb.db, { userId: owner.userId, workspaceId: owner.workspaceId }, (tx) =>
    limits.withCreationSlot(tx, owner.workspaceId, count, { capped }),
  );

describe("properties follow the plan (FR-010)", () => {
  it("refuses a third active property on Free with the limit and usage", async () => {
    const ana = await ownerOn("plan-free-props");
    await insertProperty(ana.workspaceId);
    await insertProperty(ana.workspaceId);
    await insertProperty(ana.workspaceId, "removed");
    const refused = await api(
      ctx,
      "POST",
      `/api/v1/workspaces/${ana.workspaceId}/properties`,
      ana.cookie,
      { ...READY_FACTS, name: "Casa Tercera" },
    );
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ code: "plan_limit_reached", limit: 2, used: 2 });
    const limitsView = await api(
      ctx,
      "GET",
      `/api/v1/workspaces/${ana.workspaceId}/properties/limits`,
      ana.cookie,
    );
    expect(limitsView.json()).toMatchObject({ limit: 2, used: 2, extractionLimit: 10 });
  });

  it("has no property cap on Pro and Business, and capped imports take everything", async () => {
    const pro = await ownerOn("plan-pro-props", "pro");
    for (let i = 0; i < 4; i += 1) await insertProperty(pro.workspaceId);
    await expect(slot(pro, 30, true)).resolves.toEqual({
      limit: null,
      used: 4,
      free: Number.POSITIVE_INFINITY,
    });
    await expect(slot(pro, 30)).resolves.toMatchObject({ limit: null });
    const view = await api(
      ctx,
      "GET",
      `/api/v1/workspaces/${pro.workspaceId}/properties/limits`,
      pro.cookie,
    );
    // Unlimited plans size derived limits by active properties plus 2: 2 × 6 = 12.
    expect(view.json()).toMatchObject({ limit: null, used: 4, extractionLimit: 12 });
  });

  it("lets exactly one of 10 racing creations take the last Free slot", async () => {
    const ana = await ownerOn("plan-race");
    await insertProperty(ana.workspaceId);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        withRlsContext(
          requestDb.db,
          { userId: ana.userId, workspaceId: ana.workspaceId },
          async (tx) => {
            await limits.withCreationSlot(tx, ana.workspaceId, 1);
            await tx.insert(property).values({
              workspaceId: ana.workspaceId,
              name: "Casa carrera",
              guideLanguages: ["es"],
              setupStatus: "needs_details",
              source: "manual",
            });
          },
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM property WHERE workspace_id = $1 AND status = 'active'`,
      [ana.workspaceId],
    );
    expect(rows[0]!.n).toBe(2);
  });

  it("keeps every property above the limit after a downgrade, and adds none", async () => {
    const ana = await ownerOn("plan-downgrade-props", "pro");
    for (let i = 0; i < 4; i += 1) await insertProperty(ana.workspaceId);
    await db.query(`UPDATE workspace SET plan = 'free' WHERE id = $1`, [ana.workspaceId]);
    const list = await api(
      ctx,
      "GET",
      `/api/v1/workspaces/${ana.workspaceId}/properties`,
      ana.cookie,
    );
    expect((list.json() as { items: unknown[] }).items).toHaveLength(4);
    await expect(slot(ana)).rejects.toMatchObject({ code: "plan_limit_reached" });
  });
});

describe("seats follow the plan (FR-011, FR-012)", () => {
  it("refuses any invitation on Free, where the owner holds the only seat", async () => {
    const ana = await ownerOn("plan-free-seats");
    const refused = await invite(ana);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ code: "seat_limit_reached", limit: 1, used: 1 });
    const list = await api(ctx, "GET", invitationsUrl(ana.workspaceId), ana.cookie);
    expect((list.json() as { seats: unknown }).seats).toEqual({ used: 1, limit: 1 });
  });

  it("allows 3 seats on Pro and no limit on Business", async () => {
    const pro = await ownerOn("plan-pro-seats", "pro");
    expect((await invite(pro)).statusCode).toBe(201);
    expect((await invite(pro)).statusCode).toBe(201);
    expect((await invite(pro)).statusCode).toBe(409);

    const business = await ownerOn("plan-biz-seats", "business");
    for (let i = 0; i < 5; i += 1) expect((await invite(business)).statusCode).toBe(201);
    const list = await api(ctx, "GET", invitationsUrl(business.workspaceId), business.cookie);
    expect((list.json() as { seats: unknown }).seats).toEqual({ used: 6, limit: null });
  });

  it("lets exactly one of 10 racing invitations take the last seat", async () => {
    const pro = await ownerOn("plan-seat-race", "pro");
    expect((await invite(pro)).statusCode).toBe(201);
    const results = await Promise.all(Array.from({ length: 10 }, () => invite(pro)));
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(9);
  });

  it("honors a pending invitation after a downgrade and refuses new ones", async () => {
    const pro = await ownerOn("plan-seat-downgrade", "pro");
    const email = uniqueEmail("plan-kept");
    expect((await invite(pro, email)).statusCode).toBe(201);
    await db.query(`UPDATE workspace SET plan = 'free' WHERE id = $1`, [pro.workspaceId]);
    const token = invitationTokenFor(ctx, email);
    const cookie = await signIn(ctx, email, { cookie: `guidesk.invite=${token}` });
    const accepted = await api(ctx, "POST", `/api/v1/invitations/${token}/accept`, cookie);
    expect(accepted.statusCode, accepted.body).toBe(200);
    const members = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM membership WHERE workspace_id = $1`,
      [pro.workspaceId],
    );
    expect(members.rows[0]!.n).toBe(2);
    expect((await invite(pro)).statusCode).toBe(409);
  });
});
