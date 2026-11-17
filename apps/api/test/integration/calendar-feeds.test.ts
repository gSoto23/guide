import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CalendarFeedList, CreatedCalendarFeed, StayList } from "@guidesk/contracts";
import { startIcalServer, type IcalServer } from "@guidesk/testing/ical-server";
import { systemQuery } from "./helpers.js";
import {
  captureLogs,
  insertProperty,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/** US3: calendar feeds through the isolated feed reader (T069, FR-020 to FR-026, AC-SEC-002). */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let ical: IcalServer;
let team: TeamWorkspace;

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ical = await startIcalServer(join(tmpdir(), "guidesk-ical-certs"));
  ctx = await createTestApp(inject("databaseUrl"), {
    SANDBOX_TEST_ALLOW_HOST: ical.host,
    SANDBOX_TEST_CA_FILE: ical.caFile,
  });
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "feeds");
  ical.setFeed("airbnb-a", [
    { uid: "res-1@fixture.test", start: day(3), end: day(6), summary: "Reserved" },
    {
      uid: "block-1@fixture.test",
      start: day(10),
      end: day(12),
      summary: "Airbnb (Not available)",
    },
    { uid: "open-1@fixture.test", start: day(20), end: day(23), summary: "CLOSED - Not available" },
    { uid: "past-1@fixture.test", start: day(-10), end: day(-7), summary: "Reserved" },
  ]);
  ical.setFeed("booking-a", [
    { uid: "b-1@fixture.test", start: day(30), end: day(32), summary: "Reserved" },
  ]);
  ical.setFeed("other-1", [{ uid: "o-1@fixture.test", start: day(40), end: day(41) }]);
  ical.setFeed("other-2", [{ uid: "o-2@fixture.test", start: day(50), end: day(51) }]);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
  await ical.close();
});

const feedsPath = (propertyId: string) => `/properties/${propertyId}/calendar-feeds`;

async function addFeed(propertyId: string, body: object, member = team.owner) {
  return wsApi(ctx, member, "POST", team.workspaceId, feedsPath(propertyId), body);
}

async function countEvents(type: string): Promise<{ count: number; metadata: unknown[] }> {
  const { rows } = await db.query<{ metadata: unknown }>(
    `SELECT metadata FROM security_event WHERE workspace_id = $1 AND type = $2`,
    [team.workspaceId, type],
  );
  return { count: rows.length, metadata: rows.map((row) => row.metadata) };
}

describe("saving a feed (FR-020, FR-021, FR-022)", () => {
  it("reads the link first, then returns a preview: blocks are not stays, unlabeled ones may be blocks", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const logs = captureLogs();
    const link = `${ical.url("airbnb-a")}?s=secret-feed-token`;
    const response = await addFeed(propertyId, { url: link, channel: "airbnb" });
    logs.stop();
    expect(response.statusCode, response.body).toBe(201);
    const feed = response.json() as CreatedCalendarFeed;
    expect(feed).toMatchObject({
      channel: "airbnb",
      status: "active",
      displayHint: "localhost/…/nb-a.ics",
    });
    expect(feed.upcomingStays).toEqual([
      { checkInDate: day(3), checkoutDate: day(6), mayBeBlock: false },
      { checkInDate: day(20), checkoutDate: day(23), mayBeBlock: true },
    ]);
    // Only ciphertext is stored, and the link never reaches a response or a log (AC-SEC-008).
    expect(response.body).not.toContain("secret-feed-token");
    logs.expectNoSecrets(["secret-feed-token", link]);
    const { rows } = await db.query<{ url_ciphertext: Buffer }>(
      `SELECT url_ciphertext FROM calendar_feed WHERE id = $1`,
      [feed.id],
    );
    expect(rows[0]!.url_ciphertext.toString("utf8")).not.toContain("secret-feed-token");

    const stays = (
      await wsApi(ctx, team.agent, "GET", team.workspaceId, `/properties/${propertyId}/stays`)
    ).json() as StayList;
    expect(stays.items.map((s) => [s.checkInDate, s.mayBeBlock, s.source])).toEqual([
      [day(3), false, "ical"],
      [day(20), true, "ical"],
    ]);
  });

  it.each([
    ["an http:// link", () => "http://calendar.example.test/feed.ics", "validation_failed"],
    ["the metadata address", () => "https://169.254.169.254/latest", "feed_rejected"],
    ["a redirect to 127.0.0.1", () => `${ical.origin}/redirect-local.ics`, "feed_rejected"],
    ["a page that is not iCal", () => `${ical.origin}/not-ical.html`, "feed_rejected"],
  ])("refuses %s and stores nothing (AC-SEC-002)", async (_name, link, code) => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const response = await addFeed(propertyId, {
      url: link(),
      channel: "other",
      channelLabel: "Prueba",
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code });
    const { rows } = await db.query(`SELECT 1 FROM calendar_feed WHERE property_id = $1`, [
      propertyId,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("enforces one feed per channel, distinct labels for other channels, no repeated link, and 5 at most", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    expect(
      (await addFeed(propertyId, { url: ical.url("airbnb-a"), channel: "airbnb" })).statusCode,
    ).toBe(201);
    const sameLink = await addFeed(propertyId, { url: ical.url("airbnb-a"), channel: "vrbo" });
    expect(sameLink.statusCode).toBe(409);
    expect(sameLink.json()).toMatchObject({ code: "duplicate_feed", reason: "same_link" });
    const sameChannel = await addFeed(propertyId, {
      url: ical.url("booking-a"),
      channel: "airbnb",
    });
    expect(sameChannel.statusCode).toBe(409);
    expect(sameChannel.json()).toMatchObject({ code: "duplicate_feed", reason: "same_channel" });

    expect(
      (await addFeed(propertyId, { url: ical.url("booking-a"), channel: "booking" })).statusCode,
    ).toBe(201);
    expect(
      (
        await addFeed(propertyId, {
          url: ical.url("other-1"),
          channel: "other",
          channelLabel: "Casa web",
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await addFeed(propertyId, {
          url: ical.url("other-2"),
          channel: "other",
          channelLabel: "Agencia",
        })
      ).statusCode,
    ).toBe(201);
    const sameLabel = await addFeed(propertyId, {
      url: `${ical.url("other-2")}?v=2`,
      channel: "other",
      channelLabel: "Agencia",
    });
    expect(sameLabel.json()).toMatchObject({ code: "duplicate_feed", reason: "same_channel" });
    expect(
      (await addFeed(propertyId, { url: `${ical.url("other-1")}?v=2`, channel: "vrbo" }))
        .statusCode,
    ).toBe(201);
    const sixth = await addFeed(propertyId, {
      url: `${ical.url("other-1")}?v=3`,
      channel: "other",
      channelLabel: "Sexta",
    });
    expect(sixth.statusCode).toBe(409);
    expect(sixth.json()).toMatchObject({ code: "feed_limit_reached" });
  });

  it("refuses a feed in a workspace pending deletion (FR-049)", async () => {
    const pending = await seedTeam(ctx, db, "feeds-pending");
    const propertyId = await insertProperty(db, pending.workspaceId);
    await db.query(
      `UPDATE workspace SET status = 'pending_deletion', deleted_at = now(), purge_after = now() + interval '30 days' WHERE id = $1`,
      [pending.workspaceId],
    );
    const response = await wsApi(
      ctx,
      pending.owner,
      "POST",
      pending.workspaceId,
      feedsPath(propertyId),
      {
        url: ical.url("airbnb-a"),
      },
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "workspace_pending_deletion" });
  });
});

describe("roles, refresh, and the security log (AC-SEC-001, FR-023, FR-050)", () => {
  it("answers agents 404 on feed routes and logs each refusal, while they still see stays", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const created = (
      await addFeed(propertyId, { url: ical.url("booking-a"), channel: "booking" })
    ).json() as CreatedCalendarFeed;
    const before = (await countEvents("access.role_denied")).count;
    const attempts = [
      await wsApi(ctx, team.agent, "GET", team.workspaceId, feedsPath(propertyId)),
      await wsApi(ctx, team.agent, "POST", team.workspaceId, feedsPath(propertyId), {
        url: ical.url("other-1"),
      }),
      await wsApi(ctx, team.agent, "PATCH", team.workspaceId, `/calendar-feeds/${created.id}`, {
        channelLabel: "x",
      }),
      await wsApi(ctx, team.agent, "DELETE", team.workspaceId, `/calendar-feeds/${created.id}`),
      await wsApi(ctx, team.agent, "POST", team.workspaceId, `${feedsPath(propertyId)}/refresh`),
    ];
    for (const attempt of attempts) expect(attempt.statusCode).toBe(404);
    expect((await countEvents("access.role_denied")).count).toBe(before + attempts.length);
    const stays = await wsApi(
      ctx,
      team.agent,
      "GET",
      team.workspaceId,
      `/properties/${propertyId}/stays`,
    );
    expect(stays.statusCode).toBe(200);
  });

  it("lists feeds with their hint only, and refreshes at most once every 5 minutes", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    await addFeed(propertyId, { url: `${ical.url("airbnb-a")}?s=token-2`, channel: "airbnb" });
    const list = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, feedsPath(propertyId))
    ).json() as CalendarFeedList;
    expect(list.items).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("token-2");
    const first = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `${feedsPath(propertyId)}/refresh`,
    );
    expect(first.statusCode).toBe(202);
    const second = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `${feedsPath(propertyId)}/refresh`,
    );
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({
      code: "refresh_too_soon",
      retryAfterSeconds: expect.any(Number),
    });
    expect(second.headers["retry-after"]).toBeDefined();
  });

  it("logs added, changed, and removed feeds with the channel only", async () => {
    const propertyId = await insertProperty(db, team.workspaceId);
    const created = (
      await addFeed(propertyId, {
        url: ical.url("other-1"),
        channel: "other",
        channelLabel: "Casa web",
      })
    ).json() as CreatedCalendarFeed;
    const changed = await wsApi(
      ctx,
      team.admin,
      "PATCH",
      team.workspaceId,
      `/calendar-feeds/${created.id}`,
      {
        channelLabel: "Sitio propio",
      },
    );
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({ channelLabel: "Sitio propio" });
    expect(
      (await wsApi(ctx, team.admin, "DELETE", team.workspaceId, `/calendar-feeds/${created.id}`))
        .statusCode,
    ).toBe(204);
    const { rows } = await db.query(`SELECT 1 FROM stay WHERE calendar_feed_id = $1`, [created.id]);
    expect(rows).toHaveLength(0);
    for (const type of ["calendar_feed.added", "calendar_feed.changed", "calendar_feed.removed"]) {
      const events = await countEvents(type);
      expect(events.count).toBeGreaterThan(0);
      for (const metadata of events.metadata)
        expect(Object.keys(metadata as object)).toEqual(["channel"]);
    }
  });
});
