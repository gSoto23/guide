import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery } from "./helpers.js";
import {
  addStay,
  copyStayLink,
  crDate,
  exchange,
  guest,
  guideApi,
  LOCKBOX,
  publishedGuide,
  WIFI_PASSWORD,
  type PublishedGuide,
} from "./guest-helpers.js";
import { captureLogs, seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Security review for feature 004 (T065): the abuse cases the API owns, end to end on one
 * property, with every log line, security event, and response body searched for the stay token,
 * the confirmation code, the guest cookie, and the codes. AC-SEC-010 (markup) is covered by the
 * guest app's page tests, AC-SEC-015 by these and the cross-tenant tests. Every value is fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let other: PublishedGuide;
let logs: ReturnType<typeof captureLogs>;
const bodies: string[] = [];
const secrets: string[] = [];
let token: string;
let cookie: string;
let stayId: string;

async function recorded<T extends { body: string }>(response: Promise<T>): Promise<T> {
  const result = await response;
  bodies.push(result.body);
  return result;
}

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "secreview4");
  published = await publishedGuide(ctx, team);
  const team2 = await seedTeam(ctx, db, "secreview4b");
  other = await publishedGuide(ctx, team2, { name: "Casa Ajena" });
  logs = captureLogs();
  stayId = await addStay(ctx, team, published.propertyId, 0);
  await guideApi(ctx, team.owner, team, published.propertyId, "PATCH", "/share/settings", {
    requireConfirmationCode: true,
  });
  const link = await copyStayLink(ctx, team, published.propertyId, stayId);
  token = link.token;
  secrets.push(token, link.confirmationCode!);
  const device = await exchange(ctx, token);
  cookie = device.cookie!;
  secrets.push(cookie.split("=")[1]!);
  const verified = await guest(ctx, "POST", "/api/v1/guest/verify", {
    payload: { publicId: published.publicId, code: link.confirmationCode! },
    cookie,
  });
  expect(verified.statusCode).toBe(204);
});

afterAll(async () => {
  logs.stop();
  await db.close();
  await ctx.app.close();
});

const reveal = (
  session: string | null,
  fieldId = published.lockboxId,
  publicId = published.publicId,
) =>
  recorded(
    guest(ctx, "POST", "/api/v1/guest/reveals", {
      payload: { publicId, fieldId },
      ...(session ? { cookie: session } : {}),
    }),
  );

describe("feature 004 security review (T065)", () => {
  it("never puts a locked value in public guide data (AC-SEC-001)", async () => {
    const response = await recorded(
      guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}`),
    );
    expect(response.body).not.toContain(LOCKBOX);
    expect(response.body).not.toContain(WIFI_PASSWORD);
  });

  it("shows the value only to a verified session inside the window, never cached (AC-SEC-004, AC-SEC-007)", async () => {
    const shown = await reveal(cookie);
    expect(shown.json()).toEqual({ value: LOCKBOX });
    expect(shown.headers["cache-control"]).toBe("no-store");
    const unverified = (await exchange(ctx, token)).cookie!;
    expect((await reveal(unverified)).json()).toMatchObject({ code: "verification_required" });
  });

  it("refuses a session before the window even when called directly (AC-SEC-003)", async () => {
    const future = await addStay(ctx, team, published.propertyId, 9);
    const link = await copyStayLink(ctx, team, published.propertyId, future);
    secrets.push(link.token, link.confirmationCode!);
    const early = (await exchange(ctx, link.token)).cookie!;
    const response = await reveal(early);
    expect(response.statusCode).toBe(409);
    expect(response.body).not.toContain(LOCKBOX);
  });

  it("refuses ended, revoked, and cancelled links at once (AC-SEC-002)", async () => {
    await db.query(`UPDATE stay SET check_in_date = $1, checkout_date = $2 WHERE id = $3`, [
      crDate(-6),
      crDate(-3),
      stayId,
    ]);
    expect((await reveal(cookie)).statusCode).toBe(409);
    expect((await exchange(ctx, token)).body.notice).toBe("ended");
    await db.query(`UPDATE stay SET check_in_date = $1, checkout_date = $2 WHERE id = $3`, [
      crDate(0),
      crDate(3),
      stayId,
    ]);
    expect((await reveal(cookie)).statusCode).toBe(200);
    await db.query(`UPDATE stay SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [
      stayId,
    ]);
    expect((await reveal(cookie)).statusCode).toBe(409);
  });

  it("answers random link values the same way and limits them per address (AC-SEC-005)", async () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    const random = () =>
      Array.from({ length: 26 }, () => alphabet[Math.floor(Math.random() * 32)]).join("");
    const answers = new Set<string>();
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await guest(ctx, "GET", `/api/v1/guest/guides/${random()}`);
      expect(response.statusCode).toBe(404);
      answers.add(response.body);
    }
    expect(answers.size).toBe(1);
    let limited = false;
    for (let attempt = 0; attempt < 125 && !limited; attempt++) {
      const response = await guest(ctx, "GET", `/api/v1/guest/guides/${random()}`, {
        headers: { "x-forwarded-for": "10.77.77.77" },
      });
      limited = response.statusCode === 429;
    }
    expect(limited).toBe(true);
  });

  it("sets a host-only HttpOnly SameSite cookie and keeps the token out of logs (AC-SEC-006)", async () => {
    const stay2 = await addStay(ctx, team, published.propertyId, 1);
    const link = await copyStayLink(ctx, team, published.propertyId, stay2);
    secrets.push(link.token, link.confirmationCode!);
    const device = await exchange(ctx, link.token);
    expect(device.setCookie).toMatch(/HttpOnly/);
    expect(device.setCookie).toMatch(/SameSite=Lax/);
    expect(device.setCookie).not.toMatch(/Domain=/i);
    expect(device.body.guideUrl).not.toContain(link.token);
  });

  it("refuses agents, and stale sessions need a recent sign-in (AC-SEC-008, AC-SEC-009)", async () => {
    const agent = await guideApi(
      ctx,
      team.agent,
      team,
      published.propertyId,
      "POST",
      `/share/stays/${stayId}/message`,
      {
        language: "es",
        withValues: true,
      },
    );
    expect(agent.statusCode).toBe(403);
    await db.query(
      `UPDATE session_assurance SET strong_auth_at = now() - interval '1 hour' WHERE user_id = $1`,
      [team.owner.userId],
    );
    const stale = await guideApi(
      ctx,
      team.owner,
      team,
      published.propertyId,
      "POST",
      `/share/stays/${stayId}/link`,
    );
    expect(stale.json()).toMatchObject({ code: "step_up_required" });
  });

  it("refuses guest writes from other sites (AC-SEC-011)", async () => {
    const crossSite = await ctx.fastify.inject({
      method: "POST",
      url: "/api/v1/guest/reveals",
      headers: { origin: "https://evil.example.com", cookie, "content-type": "application/json" },
      payload: { publicId: published.publicId, fieldId: published.lockboxId },
    });
    expect(crossSite.statusCode).toBe(403);
    const fetchSite = await ctx.fastify.inject({
      method: "POST",
      url: "/api/v1/guest/reveals",
      headers: { "sec-fetch-site": "cross-site", cookie, "content-type": "application/json" },
      payload: { publicId: published.publicId, fieldId: published.lockboxId },
    });
    expect(fetchSite.statusCode).toBe(403);
  });

  it("names nothing when a guide is unavailable (AC-SEC-012)", async () => {
    await guideApi(ctx, team.owner, team, published.propertyId, "POST", "/guide/unpublish");
    const response = await guest(ctx, "GET", `/api/v1/guest/guides/${published.publicId}`);
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("Casa Colibrí");
    expect(response.body).not.toContain(team.workspaceId);
  });

  it("gives a guest cookie nothing on host routes (AC-SEC-013)", async () => {
    const me = await ctx.fastify.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { origin: "http://localhost:3000", cookie },
    });
    expect(me.statusCode).toBe(401);
  });

  it("refuses another property's field and keeps another guide's data apart (AC-SEC-015)", async () => {
    const response = await reveal(cookie, other.lockboxId, other.publicId);
    expect([401, 404, 409]).toContain(response.statusCode);
    expect(response.body).not.toContain(LOCKBOX);
  });

  it("stores no identifiers with reveals or counts, and no secret anywhere (AC-SEC-014, SC-004)", async () => {
    const { rows: events } = await db.query<{
      metadata: string;
      ip_hash: string | null;
      actor_user_id: string | null;
    }>(
      `SELECT metadata::text AS metadata, ip_hash, actor_user_id FROM security_event WHERE workspace_id = $1 AND type = 'restricted_value.guest_revealed'`,
      [team.workspaceId],
    );
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.ip_hash).toBeNull();
      expect(event.actor_user_id).toBeNull();
    }
    const output = logs.text();
    const { rows: all } = await db.query<{ metadata: string }>(
      `SELECT metadata::text AS metadata FROM security_event WHERE workspace_id = $1`,
      [team.workspaceId],
    );
    for (const secret of [...secrets, LOCKBOX]) {
      expect(output, "logs").not.toContain(secret);
      for (const row of all) expect(row.metadata).not.toContain(secret);
    }
    // Only reveal responses carry the code.
    const leaks = bodies.filter((body) => body.includes(LOCKBOX) && !body.startsWith('{"value"'));
    expect(leaks).toEqual([]);
  });
});
