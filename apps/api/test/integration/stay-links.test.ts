import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { ShareOverview } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  addStay,
  copyStayLink,
  exchange,
  guideApi,
  publishedGuide,
  type PublishedGuide,
} from "./guest-helpers.js";
import { captureLogs, seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Stay links on the Share screen (feature 004 US2, T031): owners and admins copy, regenerate, and
 * revoke them after a recent sign-in; agents never see them; ineligible stays are refused; the
 * overview shows statuses and figures; tokens never reach the logs. All data is fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let logs: ReturnType<typeof captureLogs>;
const tokens: string[] = [];

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "staylinks");
  published = await publishedGuide(ctx, team);
  logs = captureLogs();
});

afterAll(async () => {
  logs.stop();
  await db.close();
  await ctx.app.close();
});

const share = (member = team.owner, suffix = "", method: "GET" | "POST" = "GET") =>
  guideApi(ctx, member, team, published.propertyId, method, `/share${suffix}`);

async function events(type: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE workspace_id = $1 AND type = $2`,
    [team.workspaceId, type],
  );
  return rows[0]?.count ?? 0;
}

describe("stay links (feature 004 US2)", () => {
  it("creates the link on first copy and returns the same one later, recording each copy", async () => {
    const stayId = await addStay(ctx, team, published.propertyId, 0);
    const first = await copyStayLink(ctx, team, published.propertyId, stayId);
    const again = await copyStayLink(ctx, team, published.propertyId, stayId, team.admin);
    tokens.push(first.token);
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:3001\/s\/[A-Za-z0-9_-]{43}$/);
    expect(again.url).toBe(first.url);
    expect(first.confirmationCode).toBeNull();
    expect(await events("guide.stay_link_copied")).toBe(2);
    const { rows } = await db.query<{ token_ciphertext: Buffer; token_hash: string }>(
      `SELECT token_ciphertext, token_hash FROM stay_link WHERE stay_id = $1`,
      [stayId],
    );
    expect(rows[0]?.token_ciphertext.toString("latin1")).not.toContain(first.token);
    expect(rows[0]?.token_hash).not.toBe(first.token);
  });

  it("asks for a recent sign-in before copying or regenerating (AC-SEC-009)", async () => {
    const stayId = await addStay(ctx, team, published.propertyId, 1);
    await db.query(
      `UPDATE session_assurance SET strong_auth_at = now() - interval '1 hour' WHERE user_id = $1`,
      [team.admin.userId],
    );
    for (const suffix of ["", "/regenerate"]) {
      const stale = await share(team.admin, `/stays/${stayId}/link${suffix}`, "POST");
      expect(stale.statusCode).toBe(403);
      expect(stale.json()).toMatchObject({ code: "step_up_required" });
    }
  });

  it("refuses agents every stay link route and hides stays from them (AC-SEC-008)", async () => {
    const stayId = await addStay(ctx, team, published.propertyId, 2);
    const before = await events("access.role_denied");
    for (const suffix of ["", "/regenerate", "/revoke"]) {
      const refused = await share(team.agent, `/stays/${stayId}/link${suffix}`, "POST");
      expect(refused.statusCode, suffix).toBe(403);
    }
    expect(await events("access.role_denied")).toBe(before + 3);
    expect(((await share(team.agent)).json() as ShareOverview).stays).toBeUndefined();
  });

  it("regenerates and revokes: the old token stops working at once (FR-021)", async () => {
    const stayId = await addStay(ctx, team, published.propertyId, 0, 2);
    const first = await copyStayLink(ctx, team, published.propertyId, stayId);
    const device = await exchange(ctx, first.token);
    expect(device.body.notice).toBeNull();
    const regenerated = await share(team.owner, `/stays/${stayId}/link/regenerate`, "POST");
    expect(regenerated.statusCode, regenerated.body).toBe(200);
    const second = (regenerated.json() as { url: string }).url.split("/s/")[1]!;
    tokens.push(first.token, second);
    expect(second).not.toBe(first.token);
    expect((await exchange(ctx, first.token)).body.notice).toBe("ended");
    expect((await exchange(ctx, second)).body.notice).toBeNull();
    const revoked = await share(team.admin, `/stays/${stayId}/link/revoke`, "POST");
    expect(revoked.statusCode).toBe(204);
    expect((await exchange(ctx, second)).body.notice).toBe("ended");
    expect(await events("guide.stay_link_regenerated")).toBe(1);
    expect(await events("guide.stay_link_revoked")).toBe(1);
  });

  it("refuses cancelled stays and stays whose window closed", async () => {
    const cancelled = await addStay(ctx, team, published.propertyId, 3);
    const cancel = await ctx.fastify.inject({
      method: "POST",
      url: `/api/v1/workspaces/${team.workspaceId}/stays/${cancelled}/cancel`,
      headers: {
        origin: "http://localhost:3000",
        cookie: team.owner.cookie,
        "content-type": "application/json",
      },
      payload: {},
    });
    expect(cancel.statusCode, cancel.body).toBeLessThan(300);
    const refused = await share(team.owner, `/stays/${cancelled}/link`, "POST");
    expect(refused.json()).toMatchObject({ code: "stay_not_eligible" });
    const past = await addStay(ctx, team, published.propertyId, 1);
    await db.query(
      `UPDATE stay SET check_in_date = current_date - 10, checkout_date = current_date - 5 WHERE id = $1`,
      [past],
    );
    expect((await share(team.owner, `/stays/${past}/link`, "POST")).json()).toMatchObject({
      code: "stay_not_eligible",
    });
  });

  it("lists open stays by check-in date with statuses and figures (FR-041)", async () => {
    await exchange(ctx, tokens[0]!);
    const overview = (await share()).json() as ShareOverview;
    const stays = overview.stays ?? [];
    expect(stays.length).toBeGreaterThan(0);
    const dates = stays.map((row) => row.checkInDate);
    expect([...dates].sort()).toEqual(dates);
    const statuses = new Set(stays.map((row) => row.link.status));
    expect(statuses.has("active")).toBe(true);
    expect(statuses.has("not_created")).toBe(true);
    expect(statuses.has("revoked")).toBe(true);
    const active = stays.find((row) => row.link.status === "active" && row.link.devices > 0);
    expect(active?.link.firstOpenedAt).toBeTruthy();
    expect(JSON.stringify(overview)).not.toMatch(/\/s\//);
  });

  it("never writes a stay token to the logs", () => {
    const output = logs.text();
    for (const token of tokens) expect(output).not.toContain(token);
  });
});
