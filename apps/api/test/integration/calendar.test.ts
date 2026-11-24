import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CalendarResponse, Stay, StayOverview } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { insertFeed, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Feature 018 (US1 to US3): the stay calendar, the stay view, and guest details on any stay.
 * Members read; owners and admins edit guest details; other workspaces get 404; the log never
 * holds the name. Fictional data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let casa: string;
let loft: string;
const ids: Record<string, string> = {};

async function insertProperty(name: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO property (workspace_id, name, guide_languages, setup_status, source, time_zone, check_in_time, checkout_time)
     VALUES ($1, $2, '{es}', 'ready', 'manual', 'America/Costa_Rica', '15:00', '11:00') RETURNING id`,
    [team.workspaceId, name],
  );
  return rows[0]!.id;
}

async function insertStay(
  propertyId: string,
  values: {
    checkIn: string;
    checkout: string;
    source?: "ical" | "manual";
    status?: string;
    guestName?: string | null;
    reference?: string | null;
  },
): Promise<string> {
  const source = values.source ?? "manual";
  const feedId =
    source === "ical"
      ? await insertFeed(db, team.workspaceId, propertyId, { channel: "airbnb" })
      : null;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO stay (workspace_id, property_id, source, calendar_feed_id, external_uid, check_in_date, checkout_date,
                       channel, status, guest_name, booking_reference, guest_details_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      team.workspaceId,
      propertyId,
      source,
      feedId,
      source === "ical" ? randomUUID() : null,
      values.checkIn,
      values.checkout,
      source === "ical" ? "airbnb" : "Directo",
      values.status ?? "active",
      values.guestName ?? null,
      values.reference ?? null,
      values.guestName ? "host" : null,
    ],
  );
  return rows[0]!.id;
}

async function insertRequest(stayId: string, propertyId: string, status: string, price: number) {
  await db.query(
    `INSERT INTO service_request (workspace_id, property_id, stay_id, extra_name, source_language, price, currency,
                                  quantity, status, expires_at)
     VALUES ($1, $2, $3, '{"es":"Traslado al aeropuerto","en":"Airport pickup"}', 'es', $4, 'USD', 2, $5, now() + interval '1 day')`,
    [team.workspaceId, propertyId, stayId, price, status],
  );
}

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "calendar");
  casa = await insertProperty("Casa Brisa");
  loft = await insertProperty("Loft Escazú");
  ids.current = await insertStay(casa, {
    checkIn: "2031-03-10",
    checkout: "2031-03-14",
    guestName: "Ana",
  });
  ids.crossing = await insertStay(loft, { checkIn: "2031-03-28", checkout: "2031-04-03" });
  ids.cancelled = await insertStay(casa, {
    checkIn: "2031-03-20",
    checkout: "2031-03-22",
    status: "cancelled",
  });
  ids.hidden = await insertStay(loft, {
    checkIn: "2031-03-05",
    checkout: "2031-03-07",
    status: "hidden",
  });
  ids.feed = await insertStay(casa, {
    checkIn: "2031-03-24",
    checkout: "2031-03-27",
    source: "ical",
    reference: "HMABC12345",
  });
  ids.april = await insertStay(casa, { checkIn: "2031-04-10", checkout: "2031-04-12" });
  await insertRequest(ids.current!, casa, "waiting", 20);
  await insertRequest(ids.current!, casa, "confirmed", 15);
  await db.query(
    `INSERT INTO conversation (workspace_id, property_id, stay_id, cookie_hash, language, status, needs_host_reason)
     VALUES ($1, $2, $3, md5(random()::text) || md5(random()::text), 'es', 'needs_host', 'malfunction')`,
    [team.workspaceId, casa, ids.current],
  );
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const march = "/calendar?from=2031-03-01&to=2031-04-01";

describe("GET calendar (FR-001 to FR-007)", () => {
  it("lists the month's stays of every property with their marks, without hidden or cancelled ones", async () => {
    const response = await wsApi(ctx, team.owner, "GET", team.workspaceId, march);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as CalendarResponse;
    expect(body.properties.map((item) => item.name)).toEqual(["Casa Brisa", "Loft Escazú"]);
    const byId = new Map(body.stays.map((item) => [item.id, item]));
    expect([...byId.keys()].sort()).toEqual([ids.current, ids.crossing, ids.feed].sort());
    expect(byId.get(ids.current!)).toMatchObject({
      guestName: "Ana",
      checkInTime: "15:00",
      checkoutTime: "11:00",
      marks: { openEscalation: true, waitingRequests: 1, confirmedExtras: 1, linkOpened: false },
    });
    expect(byId.get(ids.feed!)).toMatchObject({ bookingReference: "HMABC12345", guestName: null });
    // A stay that continues into April shows in March too.
    expect(byId.get(ids.crossing!)?.checkoutDate).toBe("2031-04-03");
  });

  it("shows cancelled stays on request, filters by property, and lets agents read", async () => {
    const all = await wsApi(ctx, team.agent, "GET", team.workspaceId, `${march}&cancelled=true`);
    expect(all.statusCode).toBe(200);
    expect((all.json() as CalendarResponse).stays.map((item) => item.id)).toContain(ids.cancelled);
    const one = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `${march}&propertyId=${loft}`,
    );
    expect((one.json() as CalendarResponse).stays.map((item) => item.id)).toEqual([ids.crossing]);
  });

  it("refuses ranges over 62 days and extra parameters, and hides other workspaces", async () => {
    const long = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      "/calendar?from=2031-01-01&to=2031-04-01",
    );
    expect(long.statusCode).toBe(422);
    const extra = await wsApi(ctx, team.owner, "GET", team.workspaceId, `${march}&x=1`);
    expect(extra.statusCode).toBe(422);
    const other = await seedTeam(ctx, db, "calendar-other");
    const theirs = await wsApi(ctx, other.owner, "GET", other.workspaceId, march);
    expect((theirs.json() as CalendarResponse).stays).toEqual([]);
    const cross = await wsApi(ctx, other.owner, "GET", other.workspaceId, `/stays/${ids.current}`);
    expect(cross.statusCode).toBe(404);
  });
});

describe("GET stays/{id} (FR-008 to FR-014)", () => {
  it("brings the stay, its link state, conversations, requests, and totals together", async () => {
    const response = await wsApi(ctx, team.agent, "GET", team.workspaceId, `/stays/${ids.current}`);
    expect(response.statusCode, response.body).toBe(200);
    const view = response.json() as StayOverview;
    expect(view.property.name).toBe("Casa Brisa");
    expect(view.stay).toMatchObject({ guestName: "Ana", guestDetails: { source: "host" } });
    expect(view.link.status).toBe("not_created");
    expect(view.conversations).toEqual([
      expect.objectContaining({ status: "needs_host", reason: "malfunction" }),
    ]);
    expect(view.requests.map((item) => item.status).sort()).toEqual(["confirmed", "waiting"]);
    expect(view.totals).toEqual([{ currency: "USD", confirmed: 30, paid: 0 }]);
    expect(view.canManage).toBe(false);
    const owner = await wsApi(ctx, team.owner, "GET", team.workspaceId, `/stays/${ids.current}`);
    expect((owner.json() as StayOverview).canManage).toBe(true);
  });
});

describe("PUT stays/{id}/guest (FR-015 to FR-018)", () => {
  it("lets owners name the guest of a feed stay and logs it without the name", async () => {
    const response = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      `/stays/${ids.feed}/guest`,
      {
        guestName: "  Beatriz  ",
        guestCount: 3,
      },
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json() as Stay).toMatchObject({
      guestName: "Beatriz",
      guestCount: 3,
      guestDetailsSource: "host",
      bookingReference: "HMABC12345",
    });
    const { rows } = await db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM security_event WHERE type = 'stay.guest_details_changed' AND target_id = $1`,
      [ids.feed],
    );
    expect(rows[0]?.metadata).toEqual({ stayId: ids.feed, name: true, count: true });
    expect(JSON.stringify(rows)).not.toContain("Beatriz");
  });

  it("refuses agents, bad input, and a name removed on request", async () => {
    const agent = await wsApi(
      ctx,
      team.agent,
      "PUT",
      team.workspaceId,
      `/stays/${ids.feed}/guest`,
      {
        guestName: "Carla",
        guestCount: null,
      },
    );
    expect(agent.statusCode).toBe(403);
    const bad = await wsApi(ctx, team.owner, "PUT", team.workspaceId, `/stays/${ids.feed}/guest`, {
      guestName: "x".repeat(121),
      guestCount: 2,
    });
    expect(bad.statusCode).toBe(422);
    const removed = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/stays/${ids.april}/remove-guest-name`,
    );
    expect(removed.statusCode).toBe(200);
    const again = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      `/stays/${ids.april}/guest`,
      {
        guestName: "Diego",
        guestCount: 2,
      },
    );
    expect(again.statusCode).toBe(409);
    const countOnly = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      `/stays/${ids.april}/guest`,
      {
        guestName: null,
        guestCount: 2,
      },
    );
    expect(countOnly.statusCode).toBe(200);
  });
});
