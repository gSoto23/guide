import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  ExtraInput,
  GuestExtras,
  GuestGuide,
  GuestServiceRequest,
  GuestServiceRequests,
  MemberExtra,
  MemberExtras,
  MemberServiceRequest,
  ServiceRequestPage,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  addStay,
  copyStayLink,
  crDate,
  exchange,
  guest,
  publishedGuide,
  type PublishedGuide,
} from "./guest-helpers.js";
import { seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Extras and requests (feature 008 T007, T010, T014): the catalog with versions, order, copy, and
 * roles; guest requests from a stay session with every rule; and member answers, first one wins.
 * Synthetic data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let other: PublishedGuide;
let cookie = "";

const pickup: ExtraInput = {
  sourceLanguage: "es",
  name: { es: "Recogida en el aeropuerto", en: "Airport pickup" },
  description: { es: "Desde Liberia (LIR).", en: "From Liberia (LIR)." },
  price: 85,
  currency: "USD",
  leadTimeHours: 24,
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  needsDate: true,
  needsTime: true,
  dateRange: "before_arrival",
  maxPerStay: 1,
  preApproved: false,
  turnover: null,
  visible: true,
};
const bikes: ExtraInput = {
  ...pickup,
  name: { es: "Bicicletas" },
  description: {},
  price: 0,
  leadTimeHours: 0,
  needsDate: false,
  needsTime: false,
  dateRange: "stay",
  maxPerStay: 2,
  preApproved: true,
};

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "extras");
  published = await publishedGuide(ctx, team);
  other = await publishedGuide(ctx, team, { name: "Casa Dos" });
  const stayId = await addStay(ctx, team, published.propertyId, 5, 4);
  const link = await copyStayLink(ctx, team, published.propertyId, stayId);
  cookie = (await exchange(ctx, link.token)).cookie!;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const path = (propertyId: string, rest = "") => `/properties/${propertyId}/extras${rest}`;
const requestAs = (payload: object, withCookie = cookie) =>
  guest(ctx, "POST", "/api/v1/guest/extras/requests?lang=es", {
    payload: { publicId: published.publicId, quantity: 1, ...payload },
    ...(withCookie ? { cookie: withCookie } : {}),
  });

let pickupId = "";
let bikesId = "";

describe("catalog (feature 008 US1)", () => {
  it("creates, edits with a version, orders, copies, and validates extras", async () => {
    const created = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(published.propertyId),
      pickup,
    );
    expect(created.statusCode, created.body).toBe(201);
    const extra = created.json() as MemberExtra;
    pickupId = extra.id;
    expect(extra).toMatchObject({ price: 85, version: 1, position: 0 });
    bikesId = (
      (
        await wsApi(ctx, team.admin, "POST", team.workspaceId, path(published.propertyId), bikes)
      ).json() as MemberExtra
    ).id;

    const edited = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path(published.propertyId, `/${pickupId}`),
      {
        version: 1,
        extra: { ...pickup, price: 90 },
      },
    );
    expect((edited.json() as MemberExtra).version).toBe(2);
    const stale = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path(published.propertyId, `/${pickupId}`),
      {
        version: 1,
        extra: pickup,
      },
    );
    expect(stale.statusCode).toBe(409);
    await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path(published.propertyId, `/${pickupId}`),
      {
        version: 2,
        extra: pickup,
      },
    );

    const ordered = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path(published.propertyId, "/order"),
      {
        ids: [bikesId, pickupId],
      },
    );
    expect((ordered.json() as MemberExtras).extras.map((item) => item.id)).toEqual([
      bikesId,
      pickupId,
    ]);

    const copied = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(published.propertyId, `/${pickupId}/copy`),
      {
        propertyIds: [other.propertyId],
      },
    );
    expect(copied.json()).toEqual({ copied: 1 });
    const there = (
      await wsApi(ctx, team.agent, "GET", team.workspaceId, path(other.propertyId))
    ).json() as MemberExtras;
    expect(there.extras.map((item) => item.name.es)).toEqual(["Recogida en el aeropuerto"]);
    expect(there.canEdit).toBe(false);

    for (const bad of [
      { ...pickup, price: -1 },
      { ...pickup, currency: "BTC" },
      { ...pickup, leadTimeHours: 721 },
      { ...pickup, maxPerStay: 11 },
      { ...pickup, name: { en: "Only English" } },
      { ...pickup, needsDate: false, needsTime: true },
      { ...pickup, turnover: "early_check_in" },
    ]) {
      const response = await wsApi(
        ctx,
        team.owner,
        "POST",
        team.workspaceId,
        path(published.propertyId),
        bad,
      );
      expect(response.statusCode, JSON.stringify(bad)).toBe(422);
    }
    const refused = await wsApi(
      ctx,
      team.agent,
      "POST",
      team.workspaceId,
      path(published.propertyId),
      pickup,
    );
    expect(refused.statusCode).toBe(403);
    const events = await db.query<{ action: string }>(
      `SELECT metadata->>'action' AS action FROM security_event WHERE workspace_id = $1 AND type = 'extras.changed' ORDER BY occurred_at`,
      [team.workspaceId],
    );
    expect(events.rows.map((row) => row.action)).toEqual([
      "created",
      "created",
      "updated",
      "updated",
      "ordered",
      "copied",
    ]);
  });
});

describe("guest requests (feature 008 US2)", () => {
  it("lists visible extras publicly and marks the guide", async () => {
    const list = await guest(
      ctx,
      "GET",
      `/api/v1/guest/guides/${published.publicId}/extras?lang=en`,
    );
    expect(list.headers["cache-control"]).toContain("s-maxage=60");
    const extras = (list.json() as GuestExtras).extras;
    expect(extras.map((item) => [item.name, item.language])).toEqual([
      ["Bicicletas", "es"],
      ["Airport pickup", "en"],
    ]);
    const guide = (
      await guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}?lang=es`)
    ).json() as GuestGuide;
    expect(guide.extras).toEqual({ visible: true });
  });

  it("refuses requests without a stay session and explains why on the list", async () => {
    const none = await guest(
      ctx,
      "GET",
      `/api/v1/guest/extras/requests?publicId=${published.publicId}`,
    );
    expect(none.json()).toEqual({ canRequest: false, reason: "no_session", requests: [] });
    const refused = await requestAs({ extraId: bikesId }, "");
    expect(refused.statusCode).toBe(401);
  });

  it("stores a waiting request with the catalog's price, confirms pre-approved ones, and refuses broken rules", async () => {
    const date = crDate(3);
    const made = await requestAs({
      extraId: pickupId,
      date,
      time: "16:30",
      note: "Somos 4",
      price: 1,
    });
    expect(made.statusCode).toBe(422); // unknown body field `price` is refused outright
    const ok = await requestAs({
      extraId: pickupId,
      date,
      time: "16:30",
      note: "Somos 4 con maletas",
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({
      status: "waiting",
      price: 85,
      currency: "USD",
      requestedDate: date,
      requestedTime: "16:30",
    });
    const again = await requestAs({ extraId: pickupId, date, time: "16:30" });
    expect(again.statusCode).toBe(422);
    expect(again.json()).toMatchObject({ code: "rule_failed", rule: "max_per_stay" });

    const confirmed = await requestAs({ extraId: bikesId, quantity: 2 });
    expect(confirmed.json()).toMatchObject({ status: "confirmed", price: 0 });

    const roomy = (
      (
        await wsApi(ctx, team.owner, "POST", team.workspaceId, path(published.propertyId), {
          ...pickup,
          name: { es: "Transporte extra" },
          maxPerStay: 10,
          visible: false,
        })
      ).json() as MemberExtra
    ).id;
    const hidden = await requestAs({ extraId: roomy, date, time: "16:30" });
    expect(hidden.statusCode).toBe(404);
    await db.query(`UPDATE extra SET visible = true, weekdays = '{1}' WHERE id = $1`, [roomy]);
    const notMonday = [1, 2, 3, 4]
      .map(crDate)
      .find((day) => new Date(`${day}T12:00:00Z`).getUTCDay() !== 1)!;
    for (const [payload, rule] of [
      [{ time: "10:00" }, "needs_date"],
      [{ date: notMonday }, "needs_time"],
      [{ date: crDate(9), time: "10:00" }, "date_range"],
      [{ date: notMonday, time: "10:00" }, "weekday"],
    ] as const) {
      const response = await requestAs({ ...payload, extraId: roomy });
      expect(response.statusCode, rule).toBe(422);
      expect((response.json() as { rule: string }).rule).toBe(rule);
    }
    await db.query(
      `UPDATE extra SET weekdays = '{1,2,3,4,5,6,7}', lead_time_hours = 720 WHERE id = $1`,
      [roomy],
    );
    const tooLate = await requestAs({ extraId: roomy, date: crDate(1), time: "10:00" });
    expect((tooLate.json() as { rule: string }).rule).toBe("lead_time");
    await db.query(`UPDATE extra SET visible = false WHERE id = $1`, [roomy]);
    const list = (
      await guest(ctx, "GET", `/api/v1/guest/extras/requests?publicId=${published.publicId}`, {
        cookie,
      })
    ).json() as GuestServiceRequests;
    expect(list.canRequest).toBe(true);
    expect(list.requests.map((item) => item.status).sort()).toEqual(["confirmed", "waiting"]);
    const counts = await db.query<{ status: string; count: number }>(
      `SELECT status, sum(count)::int AS count FROM service_request_daily WHERE property_id = $1 GROUP BY 1 ORDER BY 1`,
      [published.propertyId],
    );
    expect(counts.rows).toEqual([
      { status: "confirmed", count: 1 },
      { status: "waiting", count: 2 },
    ]);
  });

  it("lets the guest cancel a waiting request, once", async () => {
    const list = (
      await guest(ctx, "GET", `/api/v1/guest/extras/requests?publicId=${published.publicId}`, {
        cookie,
      })
    ).json() as GuestServiceRequests;
    const confirmed = list.requests.find((item) => item.status === "confirmed")!;
    const notWaiting = await guest(
      ctx,
      "POST",
      `/api/v1/guest/extras/requests/${confirmed.id}/cancel`,
      {
        payload: { publicId: published.publicId },
        cookie,
      },
    );
    expect(notWaiting.statusCode).toBe(409);
  });
});

describe("member answers (feature 008 US3)", () => {
  it("lists waiting first with the note, and the first answer wins", async () => {
    const page = (
      await wsApi(ctx, team.agent, "GET", team.workspaceId, "/service-requests?lang=es")
    ).json() as ServiceRequestPage;
    expect(page.waiting).toBe(1);
    const first = page.items[0]!;
    expect(first).toMatchObject({
      status: "waiting",
      note: "Somos 4 con maletas",
      name: "Recogida en el aeropuerto",
    });
    expect(first.stay.checkInDate).toBe(crDate(5));

    const confirmed = await wsApi(
      ctx,
      team.agent,
      "POST",
      team.workspaceId,
      `/service-requests/${first.id}/confirm`,
    );
    expect((confirmed.json() as MemberServiceRequest).status).toBe("confirmed");
    const late = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/service-requests/${first.id}/decline`,
      {
        reasonCode: "unavailable",
      },
    );
    expect(late.statusCode).toBe(409);
    const cancelled = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/service-requests/${first.id}/cancel`,
      {
        reasonCode: "fully_booked",
        reasonText: "Ya no tenemos chofer ese día",
      },
    );
    expect((cancelled.json() as MemberServiceRequest).status).toBe("host_cancelled");
    const seen = (
      await guest(ctx, "GET", `/api/v1/guest/extras/requests?publicId=${published.publicId}`, {
        cookie,
      })
    ).json() as GuestServiceRequests;
    expect(seen.requests.find((item: GuestServiceRequest) => item.id === first.id)).toMatchObject({
      status: "host_cancelled",
      reasonCode: "fully_booked",
      reasonText: "Ya no tenemos chofer ese día",
    });
    const events = await db.query<{ status: string }>(
      `SELECT metadata->>'status' AS status FROM security_event WHERE workspace_id = $1 AND type = 'service_request.answered' ORDER BY occurred_at`,
      [team.workspaceId],
    );
    expect(events.rows.map((row) => row.status)).toEqual(["confirmed", "host_cancelled"]);
  });
});
