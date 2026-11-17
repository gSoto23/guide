import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Stay, StayList } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  insertFeed,
  insertPmsConnection,
  insertProperty,
  insertStay,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/** US3: stays added by hand, hiding, and guest name removal (T070, FR-052 to FR-054). */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "stays");
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const staysPath = (propertyId: string) => `/properties/${propertyId}/stays`;

async function events(type: string): Promise<unknown[]> {
  const { rows } = await db.query<{ metadata: unknown }>(
    `SELECT metadata FROM security_event WHERE workspace_id = $1 AND type = $2 ORDER BY occurred_at`,
    [team.workspaceId, type],
  );
  return rows.map((row) => row.metadata);
}

describe("stays added by hand (FR-052, FR-054)", () => {
  it("defaults to the channel Direct and the property's times, and flags an overlap", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const feedId = await insertFeed(db, team.workspaceId, propertyId);
    await insertStay(db, team.workspaceId, propertyId, {
      source: "ical",
      calendarFeedId: feedId,
      checkInDate: day(10),
      checkoutDate: day(13),
    });
    const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, staysPath(propertyId), {
      checkInDate: day(12),
      checkoutDate: day(15),
      guestCount: 2,
      guestName: "Huésped Ficticio",
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      source: "manual",
      channel: "Direct",
      checkInTime: null,
      checkoutTime: null,
      overlaps: true,
      guestName: "Huésped Ficticio",
    });
  });

  it("can be edited and cancelled, and logs dates only", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const created = (
      await wsApi(ctx, team.admin, "POST", team.workspaceId, staysPath(propertyId), {
        checkInDate: day(20),
        checkoutDate: day(22),
        guestName: "Nombre Privado",
        channel: "Referido",
        checkInTime: "14:00",
      })
    ).json() as Stay;
    const edited = await wsApi(ctx, team.admin, "PATCH", team.workspaceId, `/stays/${created.id}`, {
      checkoutDate: day(23),
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({
      checkoutDate: day(23),
      checkInTime: "14:00",
      channel: "Referido",
    });
    const cancelled = await wsApi(
      ctx,
      team.admin,
      "POST",
      team.workspaceId,
      `/stays/${created.id}/cancel`,
    );
    expect(cancelled.json()).toMatchObject({ status: "cancelled" });
    for (const type of [
      "stay.added_manually",
      "stay.changed_manually",
      "stay.cancelled_manually",
    ]) {
      const logged = await events(type);
      expect(logged.length).toBeGreaterThan(0);
      expect(JSON.stringify(logged)).not.toContain("Nombre Privado");
      for (const metadata of logged) {
        expect(Object.keys(metadata as object).sort()).toEqual([
          "checkInDate",
          "checkoutDate",
          "stayId",
        ]);
      }
    }
  });

  it("refuses a checkout on or before check-in", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, staysPath(propertyId), {
      checkInDate: day(5),
      checkoutDate: day(5),
    });
    expect(response.statusCode).toBe(422);
  });
});

describe("feed and PMS stays are read-only, with two exceptions (FR-053)", () => {
  it("refuses edits and cancellation, but hides a stay that may be a block", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const feedId = await insertFeed(db, team.workspaceId, propertyId);
    const reservation = await insertStay(db, team.workspaceId, propertyId, {
      source: "ical",
      calendarFeedId: feedId,
      checkInDate: day(10),
      checkoutDate: day(12),
    });
    const maybeBlock = await insertStay(db, team.workspaceId, propertyId, {
      source: "ical",
      calendarFeedId: feedId,
      checkInDate: day(20),
      checkoutDate: day(22),
      mayBeBlock: true,
    });
    const edit = await wsApi(ctx, team.owner, "PATCH", team.workspaceId, `/stays/${reservation}`, {
      checkoutDate: day(13),
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json()).toMatchObject({ code: "conflict" });
    const hideReservation = await wsApi(
      ctx,
      team.owner,
      "PATCH",
      team.workspaceId,
      `/stays/${reservation}`,
      { status: "hidden" },
    );
    expect(hideReservation.statusCode).toBe(409);
    const cancel = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/stays/${reservation}/cancel`,
    );
    expect(cancel.statusCode).toBe(409);

    const hidden = await wsApi(ctx, team.owner, "PATCH", team.workspaceId, `/stays/${maybeBlock}`, {
      status: "hidden",
    });
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect(hidden.json()).toMatchObject({ status: "hidden" });
    const visible = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, staysPath(propertyId))
    ).json() as StayList;
    expect(visible.items.map((s) => s.id)).toEqual([reservation]);
  });

  it("removes a guest name from a PMS stay and a manual stay, and logs it without the name", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const connectionId = await insertPmsConnection(db, team.workspaceId);
    const pmsStay = await insertStay(db, team.workspaceId, propertyId, {
      source: "pms",
      pmsConnectionId: connectionId,
      checkInDate: day(30),
      checkoutDate: day(33),
      guestName: "Persona Ficticia",
      guestCount: 3,
    });
    const manualStay = await insertStay(db, team.workspaceId, propertyId, {
      checkInDate: day(40),
      checkoutDate: day(41),
      guestName: "Otra Persona",
    });
    for (const stayId of [pmsStay, manualStay]) {
      const response = await wsApi(
        ctx,
        team.admin,
        "POST",
        team.workspaceId,
        `/stays/${stayId}/remove-guest-name`,
      );
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ guestName: null, guestNameRemoved: true });
    }
    const { rows } = await db.query<{
      guest_name: string | null;
      guest_name_removed_at: Date | null;
    }>(`SELECT guest_name, guest_name_removed_at FROM stay WHERE id = ANY($1::uuid[])`, [
      [pmsStay, manualStay],
    ]);
    for (const row of rows) {
      expect(row.guest_name).toBeNull();
      expect(row.guest_name_removed_at).not.toBeNull();
    }
    const logged = await events("stay.guest_name_removed");
    expect(JSON.stringify(logged)).not.toMatch(/Persona Ficticia|Otra Persona/);
  });
});

describe("roles (AC-SEC-001)", () => {
  it("lets agents read stays but refuses their changes and logs each refusal", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const stayId = await insertStay(db, team.workspaceId, propertyId, {
      checkInDate: day(5),
      checkoutDate: day(6),
    });
    expect(
      (await wsApi(ctx, team.agent, "GET", team.workspaceId, staysPath(propertyId))).statusCode,
    ).toBe(200);
    const before = (await events("access.role_denied")).length;
    const attempts = [
      await wsApi(ctx, team.agent, "POST", team.workspaceId, staysPath(propertyId), {
        checkInDate: day(7),
        checkoutDate: day(8),
      }),
      await wsApi(ctx, team.agent, "PATCH", team.workspaceId, `/stays/${stayId}`, {
        checkoutDate: day(9),
      }),
      await wsApi(ctx, team.agent, "POST", team.workspaceId, `/stays/${stayId}/cancel`),
      await wsApi(ctx, team.agent, "POST", team.workspaceId, `/stays/${stayId}/remove-guest-name`),
    ];
    for (const attempt of attempts) expect(attempt.statusCode).toBe(403);
    expect((await events("access.role_denied")).length).toBe(before + attempts.length);
  });
});
