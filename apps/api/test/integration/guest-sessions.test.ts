import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuestSession } from "@guidesk/contracts";
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
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Guest sessions (feature 004 US2, T032): the token exchange, cookie attributes, unknown and
 * stopped tokens, the device limit, session reuse, and the lock state with the stay card.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "guestsessions");
  published = await publishedGuide(ctx, team);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const sessionOf = async (cookie: string | null) =>
  (
    await guest(ctx, "GET", `/api/v1/guest/session?publicId=${published.publicId}`, {
      ...(cookie ? { cookie } : {}),
    })
  ).json() as GuestSession;

describe("guest sessions (feature 004 US2)", () => {
  it("exchanges a token for a host-only HttpOnly cookie and the clean guide address (SEC-02)", async () => {
    const stayId = await addStay(ctx, team, published.propertyId, 0);
    const { token } = await copyStayLink(ctx, team, published.propertyId, stayId);
    const device = await exchange(ctx, token);
    expect(device.response.statusCode).toBe(200);
    expect(device.body).toEqual({ guideUrl: `/g/${published.publicId}`, notice: null });
    expect(device.setCookie).toMatch(
      /^guidesk_guest=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax$/,
    );
    expect(device.setCookie).not.toMatch(/Domain=/i);
    expect(device.response.headers["cache-control"]).toBe("no-store");
    const { rows } = await db.query<{ cookie_hash: string }>(
      `SELECT cookie_hash FROM guide_session s JOIN stay_link l ON l.id = s.stay_link_id WHERE l.stay_id = $1`,
      [stayId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cookie_hash).not.toBe(device.cookie?.split("=")[1]);
    // The same device opening the link again reuses its session.
    const again = await exchange(ctx, token, device.cookie!);
    expect(again.setCookie).toBeNull();
    expect(
      (
        await db.query(
          `SELECT 1 FROM guide_session s JOIN stay_link l ON l.id = s.stay_link_id WHERE l.stay_id = $1`,
          [stayId],
        )
      ).rows,
    ).toHaveLength(1);
  });

  it("records the stay's first guide open once (feature 010 research R4)", async () => {
    const stayId = await addStay(ctx, team, published.propertyId, 0);
    const opened = async () =>
      (
        await db.query<{ at: Date | null }>(
          `SELECT guide_opened_at AS at FROM stay WHERE id = $1`,
          [stayId],
        )
      ).rows[0]!.at;
    expect(await opened()).toBeNull();
    const { token } = await copyStayLink(ctx, team, published.propertyId, stayId);
    await exchange(ctx, token);
    const first = await opened();
    expect(first).toBeInstanceOf(Date);
    // A second device keeps the first time.
    await exchange(ctx, token);
    expect((await opened())?.getTime()).toBe(first!.getTime());
  });

  it("answers unknown and malformed tokens like any unavailable link (FR-054)", async () => {
    const unknown = await exchange(ctx, "A".repeat(43));
    const malformed = await exchange(ctx, "short");
    const unavailableGuide = await guest(
      ctx,
      "GET",
      "/api/v1/guest/guides/abcdefghijklmnopqrstuvwxyz",
    );
    expect(unknown.response.statusCode).toBe(404);
    expect(unknown.response.body).toBe(unavailableGuide.body);
    // Malformed values never reach a lookup: schema validation refuses them.
    expect([404, 422]).toContain(malformed.response.statusCode);
  });

  it("stops at 10 devices (FR-025)", async () => {
    const stayId = await addStay(ctx, team, published.propertyId, 1);
    const { token } = await copyStayLink(ctx, team, published.propertyId, stayId);
    for (let device = 0; device < 10; device++) {
      expect((await exchange(ctx, token)).body.notice).toBeNull();
    }
    const eleventh = await exchange(ctx, token);
    expect(eleventh.body.notice).toBe("device_limit");
    expect(eleventh.setCookie).toBeNull();
  });

  it("reports public, before, inside, and ended, with the stay card only before and inside (FR-028, FR-030)", async () => {
    expect((await sessionOf(null)).state).toBe("public");
    const future = await addStay(ctx, team, published.propertyId, 7);
    const futureLink = await copyStayLink(ctx, team, published.propertyId, future);
    const early = await exchange(ctx, futureLink.token);
    const before = await sessionOf(early.cookie);
    expect(before.state).toBe("before");
    expect(before.stay).toEqual({
      checkInDate: crDate(7),
      checkoutDate: crDate(10),
      checkInTime: "15:00",
      checkoutTime: "11:00",
    });
    expect(before.opensAt).toBeTruthy();
    expect(JSON.stringify(before)).not.toMatch(/guestName|channel|Directo/);
    // The stay moves to today in the calendar: the window follows (US2-9).
    await db.query(`UPDATE stay SET check_in_date = $1, checkout_date = $2 WHERE id = $3`, [
      crDate(0),
      crDate(2),
      future,
    ]);
    expect((await sessionOf(early.cookie)).state).toBe("inside");
    // After checkout plus the buffer: ended, and no stay card.
    await db.query(`UPDATE stay SET check_in_date = $1, checkout_date = $2 WHERE id = $3`, [
      crDate(-5),
      crDate(-2),
      future,
    ]);
    const ended = await sessionOf(early.cookie);
    expect(ended.state).toBe("ended");
    expect(ended.stay).toBeUndefined();
    expect((await exchange(ctx, futureLink.token)).body.notice).toBe("ended");
  });

  it("treats a session of another property as no session (AC-SEC-015)", async () => {
    const team2 = await seedTeam(ctx, db, "guestsessions2");
    const other = await publishedGuide(ctx, team2, { name: "Casa Vecina" });
    const stayId = await addStay(ctx, team2, other.propertyId, 0);
    const { token } = await copyStayLink(ctx, team2, other.propertyId, stayId);
    const device = await exchange(ctx, token);
    expect((await sessionOf(device.cookie)).state).toBe("public");
  });

  it("works before anyone opened the Share screen: the property link is created with the stay link", async () => {
    const team3 = await seedTeam(ctx, db, "guestsessions3");
    const fresh = await publishedGuide(ctx, team3, { name: "Casa Nueva", skipShare: true });
    const stayId = await addStay(ctx, team3, fresh.propertyId, 0);
    const { token } = await copyStayLink(ctx, team3, fresh.propertyId, stayId);
    const device = await exchange(ctx, token);
    expect(device.response.statusCode, device.response.body).toBe(200);
    expect(device.body.guideUrl).toMatch(/^\/g\/[a-z2-7]{26}$/);
  });
});
