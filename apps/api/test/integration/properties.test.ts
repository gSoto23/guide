import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { PropertyDetail, PropertyList } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  insertProperty,
  READY_FACTS,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/** US1: create a property and confirm its core facts (T036). */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "us1");
  await db.query(`UPDATE workspace SET property_limit = 10 WHERE id = $1`, [team.workspaceId]);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

async function roleDenials(workspaceId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE workspace_id = $1 AND type = 'access.role_denied'`,
    [workspaceId],
  );
  return rows[0]?.count ?? 0;
}

describe("blank property (US1, FR-001 to FR-006)", () => {
  it("creates a ready property listed with source manual and found by name", async () => {
    const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
      ...READY_FACTS,
      name: "Casa Búho",
    });
    expect(created.statusCode, created.body).toBe(201);
    const property = created.json() as PropertyDetail;
    expect(property).toMatchObject({
      name: "Casa Búho",
      setupStatus: "ready",
      missingFacts: [],
      source: "manual",
      timeZone: "America/Costa_Rica",
      checkInTime: "15:00",
      checkoutTime: "11:00",
    });

    const list = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, "/properties?query=b%C3%BAho")
    ).json() as PropertyList;
    expect(list.items.map((item) => item.id)).toEqual([property.id]);
    expect(list.items[0]).toMatchObject({
      source: "manual",
      setupStatus: "ready",
      calendarStatus: "none",
    });
  });

  it("includes the guide's status and completeness in the detail (022 FR-009)", async () => {
    const created = (
      await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
        ...READY_FACTS,
        name: "Casa Colibrí",
      })
    ).json() as PropertyDetail;
    const detail = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, `/properties/${created.id}`)
    ).json() as PropertyDetail;
    expect(detail.guide).toMatchObject({ status: "draft", hasUnpublishedChanges: false });
    expect(detail.guide?.completeness).toBeGreaterThanOrEqual(0);
  });

  it("refuses a missing fact with field errors and creates nothing", async () => {
    const { timeZone: _omitted, ...withoutZone } = READY_FACTS;
    const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
      ...withoutZone,
      name: "Casa Incompleta",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: "validation_failed",
      fields: { timeZone: expect.any(Array) },
    });
    const { rows } = await db.query(`SELECT 1 FROM property WHERE name = 'Casa Incompleta'`);
    expect(rows).toHaveLength(0);
  });

  it("refuses a time zone the runtime does not know", async () => {
    const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
      ...READY_FACTS,
      timeZone: "Mars/Olympus_Mons",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ fields: { timeZone: expect.any(Array) } });
  });

  it("lets an admin change the checkout time, returned as HH:MM in the property's zone", async () => {
    const id = await insertProperty(db, team.workspaceId);
    const patched = await wsApi(ctx, team.admin, "PATCH", team.workspaceId, `/properties/${id}`, {
      checkoutTime: "10:00",
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ checkoutTime: "10:00", timeZone: "America/Costa_Rica" });
  });

  it("makes a manual property ready when a PATCH fills its last missing fact", async () => {
    const id = await insertProperty(db, team.workspaceId, { setupStatus: "needs_details" });
    const patched = await wsApi(ctx, team.owner, "PATCH", team.workspaceId, `/properties/${id}`, {
      timeZone: "America/Costa_Rica",
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json()).toMatchObject({ setupStatus: "ready", missingFacts: [] });

    const cleared = await wsApi(ctx, team.owner, "PATCH", team.workspaceId, `/properties/${id}`, {
      checkInTime: null,
    });
    expect(cleared.json()).toMatchObject({
      setupStatus: "needs_details",
      missingFacts: ["checkInTime"],
    });
  });

  it("records edited facts on imported properties (FR-033)", async () => {
    const id = await insertProperty(db, team.workspaceId, {
      sourceProvider: "beds24",
      setupStatus: "to_confirm",
    });
    const patched = await wsApi(ctx, team.owner, "PATCH", team.workspaceId, `/properties/${id}`, {
      maxGuests: 6,
      name: "Nombre propio",
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((patched.json() as PropertyDetail).editedFacts.sort()).toEqual(["maxGuests", "name"]);
    expect(patched.json()).toMatchObject({ setupStatus: "to_confirm" });
  });
});

describe("roles and isolation (AC-SEC-001, AC-SEC-009)", () => {
  it("lets agents read but refuses their writes with 403 and logs each refusal", async () => {
    const id = await insertProperty(db, team.workspaceId);
    expect(
      (await wsApi(ctx, team.agent, "GET", team.workspaceId, `/properties/${id}`)).statusCode,
    ).toBe(200);
    expect((await wsApi(ctx, team.agent, "GET", team.workspaceId, "/properties")).statusCode).toBe(
      200,
    );

    const before = await roleDenials(team.workspaceId);
    const created = await wsApi(
      ctx,
      team.agent,
      "POST",
      team.workspaceId,
      "/properties",
      READY_FACTS,
    );
    const patched = await wsApi(ctx, team.agent, "PATCH", team.workspaceId, `/properties/${id}`, {
      name: "Cambiada",
    });
    expect(created.statusCode).toBe(403);
    expect(patched.statusCode).toBe(403);
    expect(await roleDenials(team.workspaceId)).toBe(before + 2);
  });

  it("gives the agent no feed or restricted-value details", async () => {
    const id = await insertProperty(db, team.workspaceId);
    const detail = (
      await wsApi(ctx, team.agent, "GET", team.workspaceId, `/properties/${id}`)
    ).json() as PropertyDetail;
    expect(detail.counts).toEqual({ stays: 0, feeds: null, restrictedValues: null });
  });

  it("answers 404 for another workspace's property", async () => {
    const other = await seedTeam(ctx, db, "us1-other");
    const foreign = await insertProperty(db, other.workspaceId);
    for (const method of ["GET", "PATCH"] as const) {
      const response = await wsApi(
        ctx,
        team.owner,
        method,
        team.workspaceId,
        `/properties/${foreign}`,
        method === "PATCH" ? { name: "x" } : undefined,
      );
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        type: "https://guidesk.app/problems/not_found",
        title: "Not found",
        status: 404,
        code: "not_found",
      });
    }
  });
});

describe("limits, pending deletion, and duplicates (FR-007, FR-047 to FR-049)", () => {
  it("refuses creation at the limit with {limit, used}", async () => {
    const small = await seedTeam(ctx, db, "us1-limit");
    await insertProperty(db, small.workspaceId);
    await insertProperty(db, small.workspaceId);
    const response = await wsApi(
      ctx,
      small.owner,
      "POST",
      small.workspaceId,
      "/properties",
      READY_FACTS,
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "plan_limit_reached", limit: 2, used: 2 });
    const limits = (
      await wsApi(ctx, small.agent, "GET", small.workspaceId, "/properties/limits")
    ).json();
    expect(limits).toEqual({ limit: 2, used: 2, extractionLimit: 10, extractionsUsedToday: 0 });
  });

  it("refuses creation in a workspace pending deletion", async () => {
    const pending = await seedTeam(ctx, db, "us1-pending");
    await db.query(
      `UPDATE workspace SET status = 'pending_deletion', deleted_at = now(), purge_after = now() + interval '30 days' WHERE id = $1`,
      [pending.workspaceId],
    );
    const response = await wsApi(
      ctx,
      pending.owner,
      "POST",
      pending.workspaceId,
      "/properties",
      READY_FACTS,
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "workspace_pending_deletion" });
  });

  it("finds a second property at the same address, ignoring case and accents", async () => {
    // A fresh workspace: the shared one is past the MFA threshold by now.
    const fresh = await seedTeam(ctx, db, "us1-address");
    const first = (
      await wsApi(ctx, fresh.owner, "POST", fresh.workspaceId, "/properties", {
        ...READY_FACTS,
        name: "Casa Dirección",
        addressLine1: "Avenida Ficticia 9",
      })
    ).json() as PropertyDetail;
    const check = await wsApi(
      ctx,
      fresh.owner,
      "GET",
      fresh.workspaceId,
      "/properties/address-check?line1=avenida%20ficticia%209&city=SAMARA&country=CR",
    );
    expect(check.json()).toEqual({ matches: [{ propertyId: first.id, name: "Casa Dirección" }] });
  });

  it("requires a second factor on creation once the workspace has 3 active properties (FR-048)", async () => {
    const big = await seedTeam(ctx, db, "us1-mfa");
    await db.query(`UPDATE workspace SET property_limit = 10 WHERE id = $1`, [big.workspaceId]);
    for (let i = 0; i < 3; i += 1) await insertProperty(db, big.workspaceId);
    const response = await wsApi(
      ctx,
      big.owner,
      "POST",
      big.workspaceId,
      "/properties",
      READY_FACTS,
    );
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "mfa_enrollment_required" });
  });
});
