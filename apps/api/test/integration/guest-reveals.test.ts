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
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Showing codes to guests (feature 004 US2, T033): inside the window only, for fields the
 * published guide references, under the per-session limit, recorded for the reveal history,
 * never cached, and refused at once after revocation. All codes are fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let insideCookie: string;
let stayId: string;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "guestreveals");
  published = await publishedGuide(ctx, team);
  stayId = await addStay(ctx, team, published.propertyId, 0);
  const { token } = await copyStayLink(ctx, team, published.propertyId, stayId);
  insideCookie = (await exchange(ctx, token)).cookie!;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const reveal = (cookie: string | null, fieldId = published.lockboxId) =>
  guest(ctx, "POST", "/api/v1/guest/reveals", {
    payload: { publicId: published.publicId, fieldId },
    ...(cookie ? { cookie } : {}),
  });

describe("guest reveals (feature 004 US2)", () => {
  it("shows the value inside the window, never cached, and records it (FR-029, FR-032)", async () => {
    const response = await reveal(insideCookie);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ value: LOCKBOX });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers.pragma).toBe("no-cache");
    const { rows } = await db.query<{
      actor_user_id: string | null;
      ip_hash: string | null;
      metadata: Record<string, string>;
    }>(
      `SELECT actor_user_id, ip_hash, metadata FROM security_event WHERE workspace_id = $1 AND type = 'restricted_value.guest_revealed'`,
      [team.workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: null, ip_hash: null });
    expect(rows[0]?.metadata).toMatchObject({
      stayId,
      fieldId: published.lockboxId,
      kind: "lockbox_code",
    });
    expect(JSON.stringify(rows[0]?.metadata)).not.toContain(LOCKBOX);
  });

  it("refuses without a session, before the window, and for fields outside the published guide", async () => {
    expect((await reveal(null)).json()).toMatchObject({ code: "no_session" });
    const future = await addStay(ctx, team, published.propertyId, 6);
    const { token } = await copyStayLink(ctx, team, published.propertyId, future);
    const early = (await exchange(ctx, token)).cookie!;
    const before = await reveal(early);
    expect(before.statusCode).toBe(409);
    expect(before.json()).toMatchObject({ code: "not_in_window", state: "before" });
    const unknown = await reveal(insideCookie, "00000000-0000-4000-8000-000000000000");
    expect(unknown.statusCode).toBe(404);
    // A locked field added after publishing is not in the published guide yet.
    const added = await guideApi(
      ctx,
      team.owner,
      team,
      published.propertyId,
      "POST",
      "/guide/locked-fields",
      {
        kind: "gate_code",
        label: "Portón",
        value: "735190",
      },
    );
    const draftOnly = await reveal(insideCookie, (added.json() as { id: string }).id);
    expect(draftOnly.statusCode).toBe(404);
    expect(draftOnly.body).not.toContain("735190");
  });

  it("shows a changed code on the next reveal without republishing (FR-004)", async () => {
    const changed = await guideApi(
      ctx,
      team.owner,
      team,
      published.propertyId,
      "PATCH",
      `/guide/locked-fields/${published.lockboxId}`,
      { value: "902614" },
    );
    expect(changed.statusCode, changed.body).toBe(200);
    expect((await reveal(insideCookie)).json()).toEqual({ value: "902614" });
  });

  it("limits reveals per session per hour", async () => {
    const extra = await addStay(ctx, team, published.propertyId, 0, 1);
    const { token } = await copyStayLink(ctx, team, published.propertyId, extra);
    const cookie = (await exchange(ctx, token)).cookie!;
    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await reveal(cookie)).statusCode).toBe(200);
    }
    const limited = await reveal(cookie);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeTruthy();
  });

  it("stops at once after the host revokes the link (SC-005)", async () => {
    const revoked = await guideApi(
      ctx,
      team.owner,
      team,
      published.propertyId,
      "POST",
      `/share/stays/${stayId}/link/revoke`,
    );
    expect(revoked.statusCode).toBe(204);
    const response = await reveal(insideCookie);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "not_in_window", state: "ended" });
  });
});
