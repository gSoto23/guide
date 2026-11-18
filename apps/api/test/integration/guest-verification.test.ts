import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { systemQuery } from "./helpers.js";
import {
  addStay,
  copyStayLink,
  exchange,
  guest,
  guideApi,
  LOCKBOX,
  publishedGuide,
  type PublishedGuide,
} from "./guest-helpers.js";
import { captureLogs, seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Confirmation codes (feature 004 US3, T043): the setting, the verification gate, wrong codes per
 * device, address, and stay, lockouts with backoff, the owners' and admins' alert, regenerating,
 * and turning the setting off. Codes never reach the logs. All values are fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let logs: ReturnType<typeof captureLogs>;
const codes: string[] = [];

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "guestverify");
  published = await publishedGuide(ctx, team);
  logs = captureLogs();
});

afterAll(async () => {
  logs.stop();
  await db.close();
  await ctx.app.close();
});

const settings = (member: TeamWorkspace["owner"], required: boolean) =>
  guideApi(ctx, member, team, published.propertyId, "PATCH", "/share/settings", {
    requireConfirmationCode: required,
  });

const verify = (cookie: string, code: string, ip?: string) =>
  guest(ctx, "POST", "/api/v1/guest/verify", {
    payload: { publicId: published.publicId, code },
    cookie,
    ...(ip ? { headers: { "x-forwarded-for": ip } } : {}),
  });

const reveal = (cookie: string) =>
  guest(ctx, "POST", "/api/v1/guest/reveals", {
    payload: { publicId: published.publicId, fieldId: published.lockboxId },
    cookie,
  });

/** A stay inside its window, a copied link with its code, and one device session. */
async function stayWithDevice(nights = 3) {
  const stayId = await addStay(ctx, team, published.propertyId, 0, nights);
  const link = await copyStayLink(ctx, team, published.propertyId, stayId);
  if (link.confirmationCode) codes.push(link.confirmationCode);
  const cookie = (await exchange(ctx, link.token)).cookie!;
  return { stayId, link, cookie };
}

async function alerts(): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM pgboss.job WHERE name = 'email.send' AND data->>'template' = 'guides.verification_locked' AND data->>'to' IN ($1, $2)`,
    [team.owner.email, team.admin.email],
  );
  return rows[0]?.count ?? 0;
}

describe("confirmation codes (feature 004 US3)", () => {
  it("lets only owners and admins change the setting, and gives existing links a code (FR-033)", async () => {
    const before = await stayWithDevice();
    expect(before.link.confirmationCode).toBeNull();
    expect((await settings(team.agent, true)).statusCode).toBe(403);
    const changed = await settings(team.admin, true);
    expect(changed.statusCode, changed.body).toBe(200);
    const again = await copyStayLink(ctx, team, published.propertyId, before.stayId);
    expect(again.url).toBe(before.link.url);
    expect(again.confirmationCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    codes.push(again.confirmationCode!);
    const { rows } = await db.query(
      `SELECT 1 FROM security_event WHERE workspace_id = $1 AND type = 'guide.confirmation_changed'`,
      [team.workspaceId],
    );
    expect(rows).toHaveLength(1);
  });

  it("asks for the code before the first value and verifies only that device (FR-033)", async () => {
    const { link, cookie } = await stayWithDevice();
    expect(link.confirmationCode).toBeTruthy();
    const gated = await reveal(cookie);
    expect(gated.statusCode).toBe(409);
    expect(gated.json()).toMatchObject({ code: "verification_required" });
    const wrong = await verify(cookie, "ZZZZZZ");
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toMatchObject({ code: "invalid_code", attemptsLeft: 4 });
    // Case and spaces are ignored.
    const right = await verify(
      cookie,
      ` ${link.confirmationCode!.toLowerCase().slice(0, 3)} ${link.confirmationCode!.slice(3)} `,
    );
    expect(right.statusCode, right.body).toBe(204);
    expect((await reveal(cookie)).json()).toEqual({ value: LOCKBOX });
    const otherDevice = (await exchange(ctx, link.token)).cookie!;
    expect((await reveal(otherDevice)).json()).toMatchObject({ code: "verification_required" });
  });

  it("locks the stay after 5 wrong codes from one device, and alerts owners and admins (FR-035)", async () => {
    const { link, cookie } = await stayWithDevice();
    const before = await alerts();
    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await verify(cookie, "WRONG2")).statusCode).toBe(422);
    }
    const fifth = await verify(cookie, "WRONG2");
    expect(fifth.statusCode).toBe(423);
    expect(fifth.json()).toMatchObject({ code: "verification_locked" });
    expect(Number(fifth.headers["retry-after"])).toBeGreaterThan(14 * 60);
    expect(await alerts()).toBe(before + 2);
    // Even the right code waits for the lockout to end.
    expect((await verify(cookie, link.confirmationCode!)).statusCode).toBe(423);
  });

  it("locks the stay when wrong codes come from 5 different devices and addresses", async () => {
    const { link } = await stayWithDevice();
    let last = 0;
    for (let device = 0; device < 5; device++) {
      const cookie = (await exchange(ctx, link.token)).cookie!;
      last = (await verify(cookie, "WRONG3", `10.9.${device}.1`)).statusCode;
    }
    expect(last).toBe(423);
  });

  it("doubles the next lockout of the same stay (research R8)", async () => {
    const { stayId, cookie } = await stayWithDevice();
    for (let attempt = 0; attempt < 5; attempt++) await verify(cookie, "WRONG4");
    // The first lockout ends; the next five failures lock it for 30 minutes.
    await db.query(
      `UPDATE stay_link SET locked_until = now() - interval '1 second' WHERE stay_id = $1 AND status = 'active'`,
      [stayId],
    );
    const fresh = (
      await exchange(ctx, (await copyStayLink(ctx, team, published.propertyId, stayId)).token)
    ).cookie!;
    let response = await verify(fresh, "WRONG5");
    for (let attempt = 0; attempt < 4; attempt++) response = await verify(fresh, "WRONG5");
    expect(response.statusCode).toBe(423);
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(29 * 60);
    const { rows } = await db.query<{ lockout_count: number }>(
      `SELECT lockout_count FROM stay_link WHERE stay_id = $1 AND status = 'active'`,
      [stayId],
    );
    expect(rows[0]?.lockout_count).toBe(2);
  });

  it("gives a regenerated link a new code and makes devices verify again", async () => {
    const { stayId, link, cookie } = await stayWithDevice();
    expect((await verify(cookie, link.confirmationCode!)).statusCode).toBe(204);
    const regenerated = await guideApi(
      ctx,
      team.owner,
      team,
      published.propertyId,
      "POST",
      `/share/stays/${stayId}/link/regenerate`,
    );
    const next = regenerated.json() as { url: string; confirmationCode: string };
    codes.push(next.confirmationCode);
    expect(next.confirmationCode).not.toBe(link.confirmationCode);
    const device = (await exchange(ctx, next.url.split("/s/")[1]!)).cookie!;
    expect((await reveal(device)).json()).toMatchObject({ code: "verification_required" });
  });

  it("removes the step when the owner turns the setting off", async () => {
    const { cookie } = await stayWithDevice();
    expect((await settings(team.owner, false)).statusCode).toBe(200);
    expect((await reveal(cookie)).json()).toEqual({ value: LOCKBOX });
  });

  it("never writes a confirmation code to the logs or the security log", async () => {
    const output = logs.text();
    const { rows } = await db.query<{ metadata: string }>(
      `SELECT metadata::text AS metadata FROM security_event WHERE workspace_id = $1`,
      [team.workspaceId],
    );
    for (const code of codes) {
      expect(output).not.toContain(code);
      for (const row of rows) expect(row.metadata).not.toContain(code);
    }
  });
});
